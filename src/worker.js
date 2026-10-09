function toDateKey(timestamp) {
    return new Date(Number(timestamp)).toISOString().slice(0, 10);
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
                        "SELECT ticker, shares FROM holdings ORDER BY id"
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
                    let value = 0;
                    let allHavePrice = true;

                    for (const ticker of tickers) {
                        const close = closesByTicker[ticker][date];
                        if (close != null) {
                            lastClose[ticker] = close;
                        }
                        if (lastClose[ticker] == null) {
                            allHavePrice = false;
                            break;
                        }
                        const holding = holdings.find(
                            h => h.ticker === ticker
                        );
                        if (holding) {
                            value +=
                                Number(holding.shares) * lastClose[ticker];
                        }
                    }

                    if (allHavePrice) {
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


        // EVERYTHING ELSE - STATIC FILES (index.html, styles.css, app.js)
        return env.ASSETS.fetch(request);
    }
};
