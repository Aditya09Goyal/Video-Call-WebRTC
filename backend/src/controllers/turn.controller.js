// Gives the browser TURN/STUN servers for WebRTC.
// The metered.ca key lives ONLY in the server's environment variables — never in frontend code.

const FALLBACK = [{ urls: "stun:stun.l.google.com:19302" }]; // works on most networks, no TURN
const CACHE_MS = 10 * 60 * 1000; // ask metered at most once every 10 minutes

let cache = { at: 0, servers: null };

export const getIceServers = async (req, res) => {
    res.set("Cache-Control", "no-store");

    const domain = process.env.METERED_DOMAIN;   // e.g. yourapp.metered.live
    const apiKey = process.env.METERED_API_KEY;
    if (!domain || !apiKey) {
        return res.json(FALLBACK);
    }

    if (cache.servers && Date.now() - cache.at < CACHE_MS) {
        return res.json(cache.servers);
    }

    try {
        const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`metered returned ${response.status}`);

        const servers = await response.json();
        if (!Array.isArray(servers) || servers.length === 0) throw new Error("empty ICE server list");

        cache = { at: Date.now(), servers };
        return res.json(servers);
    } catch (e) {
        console.error("Could not get TURN credentials, using STUN only:", e.message);
        return res.json(FALLBACK);
    }
}