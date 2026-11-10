const ALLOWED_ORIGINS = new Set([
  "https://newsroom.falsewinger.com",
  "https://canvas.thesportzine.com",
  "https://sripad13.github.io"
]);
const BUFFER_URL = "https://api.buffer.com";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}
function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) }
  });
}
async function bufferGraphQL(env, query, variables = {}) {
  const response = await fetch(BUFFER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.BUFFER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map(e => e.message).join("; ") || `Buffer API HTTP ${response.status}`);
  }
  return payload.data;
}
async function getChannels(env) {
  const data = await bufferGraphQL(env, `
    query StudioOrganizations {
      account {
        organizations { id name }
      }
    }
  `);
  const organizations = data.account?.organizations || [];
  const channels = [];
  for (const org of organizations) {
    const result = await bufferGraphQL(env, `
      query StudioChannels($organizationId: OrganizationId!) {
        channels(input: { organizationId: $organizationId }) {
          id name service
        }
      }
    `, { organizationId: org.id });
    for (const channel of result.channels || []) {
      channels.push({ ...channel, organizationId: org.id, organizationName: org.name });
    }
  }
  return channels;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, origin);
    if (!env.BUFFER_API_KEY) return json({ error: "Buffer API key is not configured on the Worker." }, 503, origin);
    const url = new URL(request.url);
    try {
      // Aggregated read-only analytics for the Newsroom and Posting Studio dashboards.
      if (request.method === "GET" && url.pathname === "/insights") {
        const organizations = (await bufferGraphQL(env, `
          query StudioInsightsOrganizations { account { organizations { id name } } }
        `)).account?.organizations || [];
        const now = new Date();
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const currentStart = new Date(end.getTime() - 29 * 86400000);
        const previousEnd = new Date(currentStart.getTime() - 86400000);
        const previousStart = new Date(previousEnd.getTime() - 29 * 86400000);
        const query = `
          query StudioAggregatedInsights($input: AggregatedPostMetricsInput!) {
            aggregatedPostMetrics(input: $input) {
              metrics { type name value unit }
              metricsUpdatedAt
            }
          }
        `;
        async function aggregate(start, finish) {
          const totals = {};
          let updatedAt = null;
          for (const org of organizations) {
            const data = await bufferGraphQL(env, query, { input: {
              organizationId: org.id,
              startDateTime: start.toISOString(),
              endDateTime: finish.toISOString()
            }});
            const result = data.aggregatedPostMetrics;
            updatedAt = result.metricsUpdatedAt && (!updatedAt || result.metricsUpdatedAt > updatedAt) ? result.metricsUpdatedAt : updatedAt;
            for (const metric of result.metrics || []) {
              if (!totals[metric.type]) totals[metric.type] = { type: metric.type, name: metric.name, value: 0, unit: metric.unit };
              totals[metric.type].value += metric.value;
            }
          }
          return { metrics: Object.values(totals), metricsUpdatedAt: updatedAt };
        }
        const [current, previous] = await Promise.all([
          aggregate(currentStart, end), aggregate(previousStart, previousEnd)
        ]);
        return json({
          period: "last 30 days",
          current,
          previous,
          followerCountAvailable: false,
          followerCountNote: "Buffer's public API does not expose channel-level total follower counts. Its experimental post metrics can report post-attributed follows, not total followers."
        }, 200, origin);
      }
      if (request.method === "GET" && url.pathname === "/channels") {
        return json({ channels: await getChannels(env) }, 200, origin);
      }
      if (request.method === "POST" && url.pathname === "/posts") {
        const body = await request.json();
        const text = typeof body.text === "string" ? body.text.trim() : "";
        const channelIds = Array.isArray(body.channelIds) ? [...new Set(body.channelIds)] : [];
        const mode = body.mode;
        if (!text) return json({ error: "Caption is required." }, 400, origin);
        if ([...text].length > 280) return json({ error: "Caption must be 280 characters or fewer." }, 400, origin);
        if (!channelIds.length || channelIds.length > 20 || channelIds.some(id => typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id))) {
          return json({ error: "Select one or more valid Buffer channels." }, 400, origin);
        }
        if (!["queue", "custom", "draft", "now"].includes(mode)) return json({ error: "Invalid scheduling mode." }, 400, origin);
        let dueAt = null;
        if (mode === "custom") {
          const date = new Date(body.dueAt);
          if (!body.dueAt || Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
            return json({ error: "Choose a valid future publishing date and time." }, 400, origin);
          }
          dueAt = date.toISOString();
        }
        const available = await getChannels(env);
        const allowed = new Map(available.map(c => [c.id, c]));
        const unknown = channelIds.filter(id => !allowed.has(id));
        if (unknown.length) return json({ error: "One or more selected channels are not connected to this Buffer account. Refresh channels and try again." }, 400, origin);

        // Buffer requires stable, publicly reachable HTTPS media URLs.
        const instagramSelected = channelIds.some(id => String(allowed.get(id)?.service || "").toLowerCase().includes("instagram"));
        let imageUrl = null;
        if (body.imageDataUrl && env.MEDIA_BUCKET && env.MEDIA_PUBLIC_BASE_URL) {
          const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(body.imageDataUrl);
          if (!match) return json({ error: "The graphic must be a PNG, JPG, or WebP image." }, 400, origin);
          const mimeType = match[1];
          const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
          if (!bytes.length || bytes.length > 12 * 1024 * 1024) {
            return json({ error: "The exported graphic must be smaller than 12 MB." }, 413, origin);
          }
          const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
          const key = `studio/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${extension}`;
          await env.MEDIA_BUCKET.put(key, bytes, { httpMetadata: { contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" } });
          imageUrl = `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
        }

        if (instagramSelected && !imageUrl) {
          return json({ error: "Instagram requires the finished graphic. Configure the R2 image-hosting settings, then try again." }, 400, origin);
        }
        const mutation = `
          mutation StudioCreatePost($input: CreatePostInput!) {
            createPost(input: $input) {
              ... on PostActionSuccess { post { id text status dueAt } }
              ... on MutationError { message }
            }
          }
        `;
        const results = [];
        for (const channelId of channelIds) {
          const channel = allowed.get(channelId);
          const isInstagram = String(channel.service || "").toLowerCase().includes("instagram");
          const input = {
            text,
            channelId,
            schedulingType: "automatic",
            mode: mode === "custom" ? "customScheduled" : mode === "now" ? "shareNow" : "addToQueue",
            ...(mode === "custom" ? { dueAt } : {}),
            ...(mode === "draft" ? { saveToDraft: true } : {}),
            ...(imageUrl ? { assets: [{ image: { url: imageUrl } }] } : {}),
            ...(isInstagram ? { metadata: { instagram: { type: "post", shouldShareToFeed: true } } } : {})
          };
          try {
            const data = await bufferGraphQL(env, mutation, { input });
            const result = data.createPost;
            if (result?.post) {
              results.push({ ok: true, channelId, channelName: allowed.get(channelId).name, post: result.post });
            } else {
              results.push({ ok: false, channelId, channelName: allowed.get(channelId).name, error: result?.message || "Buffer did not confirm the post." });
            }
          } catch (error) {
            results.push({ ok: false, channelId, channelName: allowed.get(channelId).name, error: error.message });
          }
        }
        const successCount = results.filter(r => r.ok).length;
        return json({ results, successCount, failedCount: results.length - successCount }, successCount ? 200 : 502, origin);
      }
      return json({ error: "Not found." }, 404, origin);
    } catch (error) {
      return json({ error: error.message || "Buffer request failed." }, 502, origin);
    }
  }
};
