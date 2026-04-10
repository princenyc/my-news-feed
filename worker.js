// signal-proxy/worker.js
// RSS proxy for The Signal. Accepts ?url= param, fetches feed, returns parsed JSON.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, ts: Date.now() });
    }

    if (url.pathname !== "/feed") {
      return json({ ok: false, error: "Use /feed?url=<encoded_feed_url>" }, 400);
    }

    const feedUrl = url.searchParams.get("url");
    if (!feedUrl) {
      return json({ ok: false, error: "Missing url param" }, 400);
    }

    let parsed;
    try { parsed = new URL(feedUrl); }
    catch { return json({ ok: false, error: "Invalid url param" }, 400); }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return json({ ok: false, error: "Only http/https allowed" }, 400);
    }

    let feedText;
    try {
      const res = await fetch(feedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SignalBot/1.0)",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });

      if (!res.ok) {
        return json({ ok: false, error: `Feed returned ${res.status}`, items: [] });
      }
      feedText = await res.text();
    } catch (e) {
      return json({ ok: false, error: `Fetch failed: ${e.message}`, items: [] });
    }

    const items = parseXml(feedText);
    return json({ ok: true, items, count: items.length });
  }
};

function parseXml(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const blockRe = new RegExp(`<${itemTag}[\\s>]([\\s\\S]*?)<\\/${itemTag}>`, "gi");
  let match;

  while ((match = blockRe.exec(xml)) !== null) {
    const block = match[1];
    const title   = extractText(block, "title");
    const link    = extractLink(block, isAtom);
    const pubDate = extractText(block, isAtom ? "updated" : "pubDate")
                 || extractText(block, "dc:date")
                 || extractText(block, "published");
    const desc    = extractText(block, "description")
                 || extractText(block, "summary")
                 || extractText(block, "content");

    if (!title && !link) continue;

    items.push({
      title:       decodeEntities(stripTags(title)).trim(),
      link:        link.trim(),
      pubDate:     pubDate.trim(),
      description: decodeEntities(stripTags(desc)).substring(0, 300).trim(),
    });
  }
  return items;
}

function extractText(block, tag) {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "i"
  );
  const m = block.match(re);
  if (!m) return "";
  return (m[1] !== undefined ? m[1] : m[2]) || "";
}

function extractLink(block, isAtom) {
  if (isAtom) {
    const hrefMatch = block.match(/<link[^>]+href="([^"]+)"/i);
    if (hrefMatch) return hrefMatch[1];
  }
  const m = block.match(/<link[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\/link>/i);
  if (m) return (m[1] || m[2] || "").trim();
  return "";
}

function stripTags(s) {
  return (s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function decodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#\d+;/g, "");
}
