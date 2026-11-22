const SESSION_COOKIE = "mf_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const PBKDF2_ITERATIONS = 150000;
const DUMMY_SALT_B64 = "MDEyMzQ1Njc4OWFiY2RlZg==";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value));
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function base64UrlToBytes(value) {
    const normalized = String(value)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;

    return base64ToBytes(normalized + "=".repeat(padding));
}

function base64UrlEncode(text) {
    return bytesToBase64Url(encoder.encode(text));
}

function base64UrlDecode(text) {
    return decoder.decode(base64UrlToBytes(text));
}

function toDateKey(timestamp) {
    return new Date(Number(timestamp)).toISOString().slice(0, 10);
}

async function hashPassword(password, saltBase64) {
    const salt = saltBase64
        ? base64ToBytes(saltBase64)
        : crypto.getRandomValues(new Uint8Array(16));

    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt,
            iterations: PBKDF2_ITERATIONS,
            hash: "SHA-256"
        },
        key,
        256
    );

    return {
        salt: bytesToBase64(salt),
        hash: bytesToBase64(new Uint8Array(bits))
    };
}

function encodePasswordHash(passwordHash) {
    return passwordHash.salt + ":" + passwordHash.hash;
}

async function verifyPassword(password, storedHash) {
    const parts = String(storedHash || "").split(":");

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return false;
    }

    const derived = await hashPassword(password, parts[0]);
    const expected = encoder.encode(parts[1]);
    const actual = encoder.encode(derived.hash);

    if (actual.length !== expected.length) {
        return false;
    }

    let difference = 0;

    for (let i = 0; i < actual.length; i += 1) {
        difference |= actual[i] ^ expected[i];
    }

    return difference === 0;
}

async function importSessionKey(secret) {
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

async function signSessionPayload(secret, payload) {
    const key = await importSessionKey(secret);
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payload)
    );

    return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySessionSignature(secret, payload, signature) {
    const key = await importSessionKey(secret);

    return crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlToBytes(signature),
        encoder.encode(payload)
    );
}

function getCookie(request, name) {
    const header = request.headers.get("Cookie") || "";

    for (const part of header.split(";")) {
        const separator = part.indexOf("=");

        if (separator === -1) {
            continue;
        }

        if (part.slice(0, separator).trim() === name) {
            return part.slice(separator + 1).trim();
        }
    }

    return null;
}

function secureCookieSuffix(url) {
    const hostname = url.hostname;

    return hostname === "localhost" || hostname === "127.0.0.1"
        ? ""
        : "; Secure";
}

async function createSessionCookie(userId, env, url) {
    const expires = Date.now() + SESSION_MAX_AGE * 1000;
    const payload = base64UrlEncode(userId + "|" + expires);
    const signature = await signSessionPayload(env.SESSION_SECRET, payload);

    return (
        SESSION_COOKIE +
        "=" +
        payload +
        "." +
        signature +
        "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
        SESSION_MAX_AGE +
        secureCookieSuffix(url)
    );
}

function clearSessionCookie(url) {
    return (
        SESSION_COOKIE +
        "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" +
        secureCookieSuffix(url)
    );
}

async function getSessionUser(request, env) {
    if (!env.SESSION_SECRET) {
        return null;
    }

    const token = getCookie(request, SESSION_COOKIE);

    if (!token) {
        return null;
    }

    const separator = token.indexOf(".");

    if (separator <= 0) {
        return null;
    }

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);

    if (!signature) {
        return null;
    }

    const valid = await verifySessionSignature(
        env.SESSION_SECRET,
        payload,
        signature
    );

    if (!valid) {
        return null;
    }

    const decoded = base64UrlDecode(payload);
    const split = decoded.lastIndexOf("|");

    if (split <= 0) {
        return null;
    }

    const id = decoded.slice(0, split);
    const expires = Number(decoded.slice(split + 1));

    if (!Number.isFinite(expires) || expires <= Date.now()) {
        return null;
    }

    const user = await env.DB
        .prepare("SELECT id, email FROM users WHERE id = ?")
        .bind(id)
        .first();

    return user || null;
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isValidEmail(email) {
    return (
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );
}

function isValidPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 8 &&
        password.length <= 128
    );
}

function isSameOrigin(request) {
    const fetchSite = request.headers.get("Sec-Fetch-Site");

    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
        return false;
    }

    const origin = request.headers.get("Origin");

    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch (error) {
        return false;
    }
}

async function handleAuth(request, env, url, pathname) {
    const method = request.method.toUpperCase();

    if (pathname === "/api/auth/me" && method === "GET") {
        const user = await getSessionUser(request, env);

        if (!user) {
            return Response.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        return Response.json({
            user: { id: user.id, email: user.email }
        });
    }

    if (pathname === "/api/auth/register" && method === "POST") {
        try {
            const data = await request.json().catch(() => ({}));
            const email = normalizeEmail(data.email);
            const password = String(data.password || "");

            if (!isValidEmail(email) || !isValidPassword(password)) {
                return Response.json(
                    {
                        error:
                            "Enter a valid email and a password of at least 8 characters."
                    },
                    { status: 400 }
                );
            }

            const existing = await env.DB
                .prepare("SELECT id FROM users WHERE email = ?")
                .bind(email)
                .first();

            if (existing) {
                return Response.json(
                    { error: "An account with that email already exists." },
                    { status: 409 }
                );
            }

            const id = crypto.randomUUID();
            const passwordHash = await hashPassword(password);

            await env.DB
                .prepare(
                    "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)"
                )
                .bind(id, email, encodePasswordHash(passwordHash))
                .run();

            return Response.json(
                { user: { id: id, email: email } },
                {
                    headers: {
                        "Set-Cookie": await createSessionCookie(
                            id,
                            env,
                            url
                        )
                    }
                }
            );
        } catch (error) {
            if (error && /UNIQUE/i.test(String(error.message))) {
                return Response.json(
                    { error: "An account with that email already exists." },
                    { status: 409 }
                );
            }

            return Response.json(
                { error: error.message },
                { status: 500 }
            );
        }
    }

    if (pathname === "/api/auth/login" && method === "POST") {
        try {
            const data = await request.json().catch(() => ({}));
            const email = normalizeEmail(data.email);
            const password = String(data.password || "");

            const user = await env.DB
                .prepare(
                    "SELECT id, email, password_hash FROM users WHERE email = ?"
                )
                .bind(email)
                .first();

            let valid = false;

            if (user) {
                valid = await verifyPassword(password, user.password_hash);
            } else {
                await hashPassword(password, DUMMY_SALT_B64);
            }

            if (!valid) {
                return Response.json(
                    { error: "Invalid email or password." },
                    { status: 401 }
                );
            }

            return Response.json(
                { user: { id: user.id, email: user.email } },
                {
                    headers: {
                        "Set-Cookie": await createSessionCookie(
                            user.id,
                            env,
                            url
                        )
                    }
                }
            );
        } catch (error) {
            return Response.json(
                { error: error.message },
                { status: 500 }
            );
        }
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
        return Response.json(
            { success: true },
            { headers: { "Set-Cookie": clearSessionCookie(url) } }
        );
    }

    return Response.json({ error: "Not found" }, { status: 404 });
}

async function getCash(env, userId) {
    const row = await env.DB
        .prepare(
            "SELECT COALESCE(SUM(" +
                "CASE type " +
                "WHEN 'BUY' THEN -(shares * price) " +
                "WHEN 'SELL' THEN (shares * price) " +
                "WHEN 'DEPOSIT' THEN amount " +
                "WHEN 'WITHDRAW' THEN -amount " +
                "ELSE 0 END" +
                "), 0) AS cash " +
                "FROM transactions WHERE is_initial = 0 AND user_id = ?"
        )
        .bind(userId)
        .first();

    return row ? Number(row.cash) : 0;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method.toUpperCase();

        if (pathname.startsWith("/api/")) {
            if (
                ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
                !isSameOrigin(request)
            ) {
                return Response.json(
                    { error: "Invalid request origin" },
                    { status: 403 }
                );
            }

            if (pathname.startsWith("/api/auth/")) {
                return handleAuth(request, env, url, pathname);
            }

            const user = await getSessionUser(request, env);

            if (!user) {
                return Response.json(
                    { error: "Unauthorized" },
                    { status: 401 }
                );
            }

            const userId = user.id;

            if (pathname === "/api/holdings" && method === "GET") {
                try {
                    const result = await env.DB
                        .prepare(
                            "SELECT id, ticker, shares, purchase_price, buy_date " +
                                "FROM holdings WHERE user_id = ? ORDER BY id"
                        )
                        .bind(userId)
                        .all();

                    const holdings = result.results;

                    if (holdings.length === 0) {
                        return Response.json([]);
                    }

                    const tickers = [
                        ...new Set(holdings.map(holding => holding.ticker))
                    ];

                    const tickerList = tickers.join(",");

                    const response = await fetch(
                        `https://api.eulerpool.com/api/1/market/quotes/latest?stocks=${encodeURIComponent(tickerList)}`,
                        {
                            headers: {
                                "Authorization": `Bearer ${env.EULERPOOL_API_KEY}`,
                                "Accept": "application/json"
                            }
                        }
                    );

                    if (!response.ok) {
                        console.error(
                            `Eulerpool error: ${response.status}`
                        );

                        return Response.json(
                            holdings.map(holding => ({
                                ...holding,
                                current_price: null
                            }))
                        );
                    }

                    const quotes = await response.json();

                    const holdingsWithPrices = holdings.map(holding => ({
                        ...holding,
                        current_price:
                            quotes[holding.ticker]?.price != null
                                ? Number(quotes[holding.ticker].price)
                                : null
                    }));

                    return Response.json(holdingsWithPrices);
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/daily-change" && method === "GET") {
                try {
                    const result = await env.DB
                        .prepare(
                            "SELECT ticker, shares FROM holdings " +
                                "WHERE user_id = ? ORDER BY id"
                        )
                        .bind(userId)
                        .all();

                    const holdings = result.results;

                    if (holdings.length === 0) {
                        return Response.json({
                            totalDailyChange: 0,
                            totalDailyChangePct: 0,
                            portfolioValue: 0
                        });
                    }

                    const tickers = [
                        ...new Set(holdings.map(holding => holding.ticker))
                    ];
                    const tickerList = tickers.join(",");

                    const quotesResponse = await fetch(
                        `https://api.eulerpool.com/api/1/market/quotes/latest?stocks=${encodeURIComponent(tickerList)}`,
                        {
                            headers: {
                                "Authorization": `Bearer ${env.EULERPOOL_API_KEY}`,
                                "Accept": "application/json"
                            }
                        }
                    );

                    if (!quotesResponse.ok) {
                        return Response.json(
                            { error: "Failed to fetch quotes" },
                            { status: 500 }
                        );
                    }

                    const quotes = await quotesResponse.json();

                    const changeResults = await Promise.all(
                        tickers.map(ticker =>
                            fetch(
                                `https://api.eulerpool.com/api/1/equity/price-change/${encodeURIComponent(ticker)}`,
                                {
                                    headers: {
                                        "Authorization": `Bearer ${env.EULERPOOL_API_KEY}`,
                                        "Accept": "application/json"
                                    }
                                }
                            )
                                .then(async res => {
                                    if (!res.ok) {
                                        return { ticker, change1D: 0 };
                                    }
                                    const data = await res.json();
                                    const change1D =
                                        data.data && data.data[0]
                                            ? Number(data.data[0]["1D"]) || 0
                                            : 0;
                                    return { ticker, change1D };
                                })
                                .catch(() => ({ ticker, change1D: 0 }))
                        )
                    );

                    const changeMap = {};
                    for (const c of changeResults) {
                        changeMap[c.ticker] = c.change1D;
                    }

                    let portfolioValue = 0;
                    let dailyChangeValue = 0;

                    for (const holding of holdings) {
                        const price = quotes[holding.ticker]?.price;
                        if (price != null) {
                            const value = Number(holding.shares) * Number(price);
                            portfolioValue += value;
                            const chgPct = changeMap[holding.ticker] || 0;
                            dailyChangeValue += value * (chgPct / 100);
                        }
                    }

                    return Response.json({
                        totalDailyChange: dailyChangeValue,
                        totalDailyChangePct:
                            portfolioValue > 0
                                ? (dailyChangeValue / portfolioValue) * 100
                                : 0,
                        portfolioValue: portfolioValue
                    });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (
                pathname === "/api/portfolio/candles" &&
                method === "GET"
            ) {
                try {
                    const interval =
                        url.searchParams.get("interval") || "1d";
                    const limit = parseInt(
                        url.searchParams.get("limit") || "30",
                        10
                    );

                    const result = await env.DB
                        .prepare(
                            "SELECT ticker, shares, buy_date FROM holdings " +
                                "WHERE user_id = ? ORDER BY id"
                        )
                        .bind(userId)
                        .all();

                    const holdings = result.results;

                    if (holdings.length === 0) {
                        return Response.json([]);
                    }

                    const tickers = [
                        ...new Set(holdings.map(holding => holding.ticker))
                    ];

                    const candleResults = await Promise.all(
                        tickers.map(ticker =>
                            fetch(
                                `https://api.eulerpool.com/api/1/equity/candles/${encodeURIComponent(ticker)}?interval=${encodeURIComponent(interval)}&limit=${limit}`,
                                {
                                    headers: {
                                        "Authorization": `Bearer ${env.EULERPOOL_API_KEY}`,
                                        "Accept": "application/json"
                                    }
                                }
                            )
                                .then(async res => {
                                    if (!res.ok) {
                                        return { ticker, candles: [] };
                                    }
                                    const data = await res.json();
                                    return {
                                        ticker,
                                        candles: Array.isArray(data) ? data : []
                                    };
                                })
                                .catch(() => ({ ticker, candles: [] }))
                        )
                    );

                    const candleMap = {};
                    for (const c of candleResults) {
                        candleMap[c.ticker] = c.candles;
                    }

                    const dateSet = new Set();
                    for (const ticker of tickers) {
                        for (const candle of candleMap[ticker] || []) {
                            if (
                                candle &&
                                candle.timestamp != null &&
                                candle.close != null
                            ) {
                                dateSet.add(toDateKey(candle.timestamp));
                            }
                        }
                    }

                    const dates = Array.from(dateSet).sort();

                    const closesByTicker = {};
                    for (const ticker of tickers) {
                        closesByTicker[ticker] = {};
                        for (const candle of candleMap[ticker] || []) {
                            if (
                                candle &&
                                candle.timestamp != null &&
                                candle.close != null
                            ) {
                                closesByTicker[ticker][
                                    toDateKey(candle.timestamp)
                                ] = Number(candle.close);
                            }
                        }
                    }

                    const lastClose = {};
                    const history = [];

                    for (const date of dates) {
                        for (const ticker of tickers) {
                            const close = closesByTicker[ticker][date];
                            if (close != null) {
                                lastClose[ticker] = close;
                            }
                        }

                        let value = 0;
                        let missing = false;

                        for (const holding of holdings) {
                            const buyDate = String(
                                holding.buy_date || ""
                            ).slice(0, 10);

                            if (buyDate && date < buyDate) {
                                continue;
                            }

                            const close = lastClose[holding.ticker];
                            if (close == null) {
                                missing = true;
                                break;
                            }

                            value += Number(holding.shares) * close;
                        }

                        if (!missing) {
                            history.push({
                                timestamp: new Date(
                                    date + "T00:00:00Z"
                                ).getTime(),
                                value: value
                            });
                        }
                    }

                    return Response.json(history.slice(-limit));
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/holdings" && method === "POST") {
                try {
                    const data = await request.json();

                    const ticker = String(data.ticker || "")
                        .trim()
                        .toUpperCase();

                    const shares = Number(data.shares);
                    const purchasePrice = Number(data.purchasePrice);
                    const buyDate = String(data.buyDate || "");

                    if (
                        !ticker ||
                        !Number.isFinite(shares) ||
                        shares <= 0 ||
                        !Number.isFinite(purchasePrice) ||
                        purchasePrice <= 0 ||
                        !buyDate
                    ) {
                        return Response.json(
                            { error: "Invalid holding data" },
                            { status: 400 }
                        );
                    }

                    const result = await env.DB
                        .prepare(
                            "INSERT INTO holdings " +
                                "(user_id, ticker, shares, purchase_price, buy_date) " +
                                "VALUES (?, ?, ?, ?, ?)"
                        )
                        .bind(
                            userId,
                            ticker,
                            shares,
                            purchasePrice,
                            buyDate
                        )
                        .run();

                    await env.DB
                        .prepare(
                            "INSERT INTO transactions " +
                                "(user_id, ticker, type, shares, price, amount, date, is_initial) " +
                                "VALUES (?, ?, 'BUY', ?, ?, 0, ?, 0)"
                        )
                        .bind(
                            userId,
                            ticker,
                            shares,
                            purchasePrice,
                            buyDate
                        )
                        .run();

                    return Response.json({
                        success: true,
                        id: result.meta.last_row_id
                    });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (
                pathname.startsWith("/api/holdings/") &&
                method === "DELETE"
            ) {
                try {
                    const id = pathname.split("/").pop();

                    if (!id || !/^\d+$/.test(id)) {
                        return Response.json(
                            { error: "Invalid holding ID" },
                            { status: 400 }
                        );
                    }

                    const result = await env.DB
                        .prepare(
                            "DELETE FROM holdings WHERE id = ? AND user_id = ?"
                        )
                        .bind(id, userId)
                        .run();

                    if (!result.meta || result.meta.changes === 0) {
                        return Response.json(
                            { error: "Holding not found" },
                            { status: 404 }
                        );
                    }

                    return Response.json({ success: true });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/cash" && method === "GET") {
                try {
                    const cash = await getCash(env, userId);

                    return Response.json({ cash });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/transactions" && method === "GET") {
                try {
                    const result = await env.DB
                        .prepare(
                            "SELECT id, ticker, type, shares, price, amount, date, is_initial " +
                                "FROM transactions WHERE user_id = ? " +
                                "ORDER BY date DESC, id DESC"
                        )
                        .bind(userId)
                        .all();

                    const cash = await getCash(env, userId);

                    return Response.json({
                        transactions: result.results,
                        cash: cash
                    });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/sell" && method === "POST") {
                try {
                    const data = await request.json();

                    const holdingId = Number(data.holdingId);
                    const shares = Number(data.shares);
                    const price = Number(data.price);
                    const date = String(data.date || "");

                    if (
                        !Number.isInteger(holdingId) ||
                        !Number.isFinite(shares) ||
                        shares <= 0 ||
                        !Number.isFinite(price) ||
                        price <= 0 ||
                        !date
                    ) {
                        return Response.json(
                            { error: "Invalid sell data" },
                            { status: 400 }
                        );
                    }

                    const holding = await env.DB
                        .prepare(
                            "SELECT id, ticker, shares FROM holdings " +
                                "WHERE id = ? AND user_id = ?"
                        )
                        .bind(holdingId, userId)
                        .first();

                    if (!holding) {
                        return Response.json(
                            { error: "Holding not found" },
                            { status: 404 }
                        );
                    }

                    const ownedShares = Number(holding.shares);

                    if (shares > ownedShares) {
                        return Response.json(
                            {
                                error:
                                    "Cannot sell more shares than you own"
                            },
                            { status: 400 }
                        );
                    }

                    await env.DB
                        .prepare(
                            "INSERT INTO transactions " +
                                "(user_id, ticker, type, shares, price, amount, date, is_initial) " +
                                "VALUES (?, ?, 'SELL', ?, ?, 0, ?, 0)"
                        )
                        .bind(userId, holding.ticker, shares, price, date)
                        .run();

                    if (shares >= ownedShares) {
                        await env.DB
                            .prepare(
                                "DELETE FROM holdings WHERE id = ? AND user_id = ?"
                            )
                            .bind(holdingId, userId)
                            .run();
                    } else {
                        await env.DB
                            .prepare(
                                "UPDATE holdings SET shares = ? " +
                                    "WHERE id = ? AND user_id = ?"
                            )
                            .bind(ownedShares - shares, holdingId, userId)
                            .run();
                    }

                    return Response.json({ success: true });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            if (pathname === "/api/cash" && method === "POST") {
                try {
                    const data = await request.json();

                    const type = String(data.type || "").toUpperCase();
                    const amount = Number(data.amount);
                    const date = String(data.date || "");

                    if (
                        (type !== "DEPOSIT" && type !== "WITHDRAW") ||
                        !Number.isFinite(amount) ||
                        amount <= 0 ||
                        !date
                    ) {
                        return Response.json(
                            { error: "Invalid cash data" },
                            { status: 400 }
                        );
                    }

                    await env.DB
                        .prepare(
                            "INSERT INTO transactions " +
                                "(user_id, ticker, type, shares, price, amount, date, is_initial) " +
                                "VALUES (?, NULL, ?, 0, 0, ?, ?, 0)"
                        )
                        .bind(userId, type, amount, date)
                        .run();

                    const cash = await getCash(env, userId);

                    return Response.json({ success: true, cash: cash });
                } catch (error) {
                    return Response.json(
                        { error: error.message },
                        { status: 500 }
                    );
                }
            }

            return Response.json({ error: "Not found" }, { status: 404 });
        }

        return env.ASSETS.fetch(request);
    }
};
