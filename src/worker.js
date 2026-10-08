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
