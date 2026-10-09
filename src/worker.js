function toDateKey(timestamp) {
    return new Date(Number(timestamp)).toISOString().slice(0, 10);
}

let schemaReady = false;

async function ensureSchema(env) {
    if (schemaReady) return;

    await env.DB
        .prepare(
            "CREATE TABLE IF NOT EXISTS transactions (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "ticker TEXT, " +
                "type TEXT NOT NULL, " +
                "shares REAL NOT NULL DEFAULT 0, " +
                "price REAL NOT NULL DEFAULT 0, " +
                "amount REAL NOT NULL DEFAULT 0, " +
                "date TEXT NOT NULL, " +
                "is_initial INTEGER NOT NULL DEFAULT 0, " +
                "created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
                ")"
        )
        .run();

    schemaReady = true;
}

// If the transaction log is empty, seed it from existing holdings so the
// history is complete. These initial buys are flagged and do not affect cash.
async function seedInitialTransactions(env) {
    const count = await env.DB
        .prepare("SELECT COUNT(*) AS c FROM transactions")
        .first();

    if (count && count.c > 0) {
        return;
    }

    const holdings = await env.DB
        .prepare(
            "SELECT ticker, shares, purchase_price, buy_date FROM holdings"
        )
        .all();

    if (!holdings.results || holdings.results.length === 0) {
        return;
    }

    const statements = holdings.results.map(holding =>
        env.DB
            .prepare(
                "INSERT INTO transactions (ticker, type, shares, price, amount, date, is_initial) " +
                    "VALUES (?, 'BUY', ?, ?, 0, ?, 1)"
            )
            .bind(
                holding.ticker,
                holding.shares,
                holding.purchase_price,
                holding.buy_date
            )
    );

    await env.DB.batch(statements);
}

async function prepareTransactions(env) {
    await ensureSchema(env);
    await seedInitialTransactions(env);
}

async function getCash(env) {
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
                "FROM transactions WHERE is_initial = 0"
        )
        .first();

    return row ? Number(row.cash) : 0;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // GET HOLDINGS
        if (url.pathname === "/api/holdings" && request.method === "GET") {
            try {
                const result = await env.DB
                    .prepare(
                        "SELECT id, ticker, shares, purchase_price, buy_date FROM holdings ORDER BY id"
                    )
                    .all();

                const holdings = result.results;

                if (holdings.length === 0) {
                    return Response.json([]);
                }

                // Get unique tickers
                const tickers = [
                    ...new Set(holdings.map(holding => holding.ticker))
                ];

                // ONE API CALL for all tickers
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

                // Attach the price to each holding
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


        // GET DAILY CHANGE FOR ALL HOLDINGS
        if (url.pathname === "/api/daily-change" && request.method === "GET") {
            try {
                const result = await env.DB
                    .prepare(
                        "SELECT ticker, shares FROM holdings ORDER BY id"
                    )
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
                                if (!res.ok) return { ticker, change1D: 0 };
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

        // GET PORTFOLIO VALUE HISTORY (candles for all holdings)
        if (
            url.pathname === "/api/portfolio/candles" &&
            request.method === "GET"
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
                        "SELECT ticker, shares, buy_date FROM holdings ORDER BY id"
                    )
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
                                if (!res.ok) return { ticker, candles: [] };
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
                    // Carry forward the latest known close for each ticker
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

                        // Not owned yet on this date - contributes 0
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

        // ADD HOLDING
        if (url.pathname === "/api/holdings" && request.method === "POST") {
            try {
                await prepareTransactions(env);

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
                        "INSERT INTO holdings (ticker, shares, purchase_price, buy_date) VALUES (?, ?, ?, ?)"
                    )
                    .bind(
                        ticker,
                        shares,
                        purchasePrice,
                        buyDate
                    )
                    .run();

                await env.DB
                    .prepare(
                        "INSERT INTO transactions (ticker, type, shares, price, amount, date, is_initial) " +
                            "VALUES (?, 'BUY', ?, ?, 0, ?, 0)"
                    )
                    .bind(
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


        // DELETE HOLDING
        if (
            url.pathname.startsWith("/api/holdings/") &&
            request.method === "DELETE"
        ) {
            try {
                const id = url.pathname.split("/").pop();

                if (!id || !/^\d+$/.test(id)) {
                    return Response.json(
                        { error: "Invalid holding ID" },
                        { status: 400 }
                    );
                }

                await env.DB
                    .prepare("DELETE FROM holdings WHERE id = ?")
                    .bind(id)
                    .run();

                return Response.json({
                    success: true
                });

            } catch (error) {
                return Response.json(
                    { error: error.message },
                    { status: 500 }
                );
            }
        }


        // GET CASH BALANCE
        if (url.pathname === "/api/cash" && request.method === "GET") {
            try {
                await prepareTransactions(env);
                const cash = await getCash(env);
                return Response.json({ cash });
            } catch (error) {
                return Response.json(
                    { error: error.message },
                    { status: 500 }
                );
            }
        }

        // GET TRANSACTION HISTORY (buys, sells, deposits, withdrawals)
        if (url.pathname === "/api/transactions" && request.method === "GET") {
            try {
                await prepareTransactions(env);

                const result = await env.DB
                    .prepare(
                        "SELECT id, ticker, type, shares, price, amount, date, is_initial " +
                            "FROM transactions ORDER BY date DESC, id DESC"
                    )
                    .all();

                const cash = await getCash(env);

                return Response.json({
                    transactions: result.results,
                    cash
                });
            } catch (error) {
                return Response.json(
                    { error: error.message },
                    { status: 500 }
                );
            }
        }

        // SELL SHARES FROM A HOLDING
        if (url.pathname === "/api/sell" && request.method === "POST") {
            try {
                await prepareTransactions(env);

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
                        "SELECT id, ticker, shares FROM holdings WHERE id = ?"
                    )
                    .bind(holdingId)
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
                        { error: "Cannot sell more shares than you own" },
                        { status: 400 }
                    );
                }

                await env.DB
                    .prepare(
                        "INSERT INTO transactions (ticker, type, shares, price, amount, date, is_initial) " +
                            "VALUES (?, 'SELL', ?, ?, 0, ?, 0)"
                    )
                    .bind(holding.ticker, shares, price, date)
                    .run();

                if (shares >= ownedShares) {
                    await env.DB
                        .prepare("DELETE FROM holdings WHERE id = ?")
                        .bind(holdingId)
                        .run();
                } else {
                    await env.DB
                        .prepare(
                            "UPDATE holdings SET shares = ? WHERE id = ?"
                        )
                        .bind(ownedShares - shares, holdingId)
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

        // ADD OR WITHDRAW CASH
        if (url.pathname === "/api/cash" && request.method === "POST") {
            try {
                await prepareTransactions(env);

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
                        "INSERT INTO transactions (ticker, type, shares, price, amount, date, is_initial) " +
                            "VALUES (NULL, ?, 0, 0, ?, ?, 0)"
                    )
                    .bind(type, amount, date)
                    .run();

                const cash = await getCash(env);

                return Response.json({ success: true, cash });
            } catch (error) {
                return Response.json(
                    { error: error.message },
                    { status: 500 }
                );
            }
        }

        // EVERYTHING ELSE - STATIC FILES (index.html, styles.css, app.js)
        return env.ASSETS.fetch(request);
    }
};
