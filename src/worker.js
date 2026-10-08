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


        const HTML = `<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>MaurerFunds</title>

<style>

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f4f6f8;
    color: #1f2937;
}

header {
    background: #111827;
    color: white;
    padding: 20px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.logo {
    font-size: 26px;
    font-weight: bold;
}

.subtitle {
    color: #9ca3af;
    font-size: 14px;
    margin-top: 3px;
}

main {
    max-width: 1400px;
    margin: 40px auto;
    padding: 0 20px;
}

.summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-bottom: 30px;
}

.card {
    background: white;
    border-radius: 12px;
    padding: 25px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
}

.card-title {
    color: #6b7280;
    font-size: 14px;
    margin-bottom: 10px;
}

.card-value {
    font-size: 28px;
    font-weight: bold;
}

.section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 15px;
}

.section-header h2 {
    font-size: 22px;
}

.add-button {
    background: #111827;
    color: white;
    border: none;
    padding: 11px 18px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
}

.add-button:hover {
    background: #374151;
}

.table-container {
    background: white;
    border-radius: 12px;
    overflow-x: auto;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
}

table {
    width: 100%;
    border-collapse: collapse;
}

th {
    background: #f9fafb;
    text-align: left;
    padding: 16px;
    font-size: 13px;
    color: #6b7280;
    border-bottom: 1px solid #e5e7eb;
    white-space: nowrap;
}

td {
    padding: 16px;
    border-bottom: 1px solid #e5e7eb;
    font-size: 14px;
    white-space: nowrap;
}

tr:last-child td {
    border-bottom: none;
}

.ticker {
    font-weight: bold;
}

.gain {
    color: #15803d;
    font-weight: bold;
}

.loss {
    color: #b91c1c;
    font-weight: bold;
}

.delete-button {
    background: #fee2e2;
    color: #b91c1c;
    border: none;
    padding: 7px 12px;
    border-radius: 6px;
    cursor: pointer;
}

.delete-button:hover {
    background: #fecaca;
}

.empty {
    text-align: center;
    padding: 40px;
    color: #6b7280;
}

.modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    justify-content: center;
    align-items: center;
    padding: 20px;
}

.modal {
    background: white;
    width: 100%;
    max-width: 450px;
    border-radius: 12px;
    padding: 30px;
}

.modal h2 {
    margin-bottom: 25px;
}

.form-group {
    margin-bottom: 18px;
}

label {
    display: block;
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 7px;
}

input {
    width: 100%;
    padding: 11px;
    border: 1px solid #d1d5db;
    border-radius: 7px;
    font-size: 15px;
}

input:focus {
    outline: none;
    border-color: #111827;
}

.modal-buttons {
    display: flex;
    gap: 10px;
    margin-top: 25px;
}

.save-button {
    flex: 1;
    background: #111827;
    color: white;
    border: none;
    padding: 12px;
    border-radius: 7px;
    cursor: pointer;
    font-weight: bold;
}

.cancel-button {
    flex: 1;
    background: #e5e7eb;
    color: #374151;
    border: none;
    padding: 12px;
    border-radius: 7px;
    cursor: pointer;
    font-weight: bold;
}

.error {
    color: #b91c1c;
    font-size: 14px;
    margin-top: 10px;
    display: none;
}

@media(max-width:700px) {

    header {
        padding: 18px 20px;
    }

    main {
        margin-top: 25px;
    }

    .summary {
        grid-template-columns: 1fr;
    }

    .section-header {
        align-items: flex-start;
        gap: 15px;
    }

    .card-value {
        font-size: 24px;
    }
}

</style>

</head>

<body>

<header>

<div>

<div class="logo">
MaurerFunds
</div>

<div class="subtitle">
Investment Portfolio
</div>

</div>

</header>

<main>

<div class="summary">

<div class="card">

<div class="card-title">
Total Invested
</div>

<div
    class="card-value"
    id="totalInvested"
>
$0.00
</div>

</div>


<div class="card">

<div class="card-title">
Current Portfolllllllio Value
</div>

<div
    class="card-value"
    id="portfolioValue"
>
$0.00
</div>

</div>


<div class="card">

<div class="card-title">
Total Gain/Loss
</div>

<div
    class="card-value"
    id="totalGainLoss"
>
$0.00
</div>

</div>

</div>


<div class="summary">

<div class="card">

<div class="card-title">
Number of Holdings
</div>

<div
    class="card-value"
    id="holdingCount"
>
0
</div>

</div>


<div class="card">

<div class="card-title">
Total Shares
</div>

<div
    class="card-value"
    id="totalShares"
>
0
</div>

</div>

</div>


<div class="section-header">

<h2>
Holdings
</h2>

<button
    class="add-button"
    onclick="openModal()"
>
+ Add Holding
</button>

</div>


<div class="table-container">

<table>

<thead>

<tr>

<th>Ticker</th>

<th>Shares</th>

<th>Purchase Price</th>

<th>Current Price</th>

<th>Current Value</th>

<th>Gain/Loss</th>

<th>Buy Date</th>

<th>Action</th>

</tr>

</thead>


<tbody id="holdingsTable">

<tr>

<td
    colspan="8"
    class="empty"
>
Loading holdings...
</td>

</tr>

</tbody>

</table>

</div>

</main>


<div
    class="modal-overlay"
    id="modal"
>

<div class="modal">

<h2>
Add Holding
</h2>


<form id="holdingForm">

<div class="form-group">

<label for="ticker">
Ticker
</label>

<input
    type="text"
    id="ticker"
    placeholder="AAPL"
    required
>

</div>


<div class="form-group">

<label for="shares">
Shares
</label>

<input
    type="number"
    id="shares"
    placeholder="10"
    step="0.0001"
    min="0.0001"
    required
>

</div>


<div class="form-group">

<label for="purchasePrice">
Purchase Price
</label>

<input
    type="number"
    id="purchasePrice"
    placeholder="150.00"
    step="0.01"
    min="0.01"
    required
>

</div>


<div class="form-group">

<label for="buyDate">
Purchase Date
</label>

<input
    type="date"
    id="buyDate"
    required
>

</div>


<div
    class="error"
    id="formError"
>
</div>


<div class="modal-buttons">

<button
    type="button"
    class="cancel-button"
    onclick="closeModal()"
>
Cancel
</button>


<button
    type="submit"
    class="save-button"
>
Add Holding
</button>

</div>

</form>

</div>

</div>


<script>

async function loadHoldings() {

    const table =
        document.getElementById("holdingsTable");

    try {

        const response =
            await fetch("/api/holdings");

        if (!response.ok) {
            throw new Error(
                "Failed to load holdings"
            );
        }

        const holdings =
            await response.json();

        renderHoldings(holdings);

    } catch (error) {

        table.innerHTML =
            '<tr>' +
            '<td colspan="8" class="empty">' +
            'Unable to load holdings.' +
            '</td>' +
            '</tr>';

        console.error(error);
    }
}


function renderHoldings(holdings) {

    const table =
        document.getElementById("holdingsTable");

    if (!holdings || holdings.length === 0) {

        table.innerHTML =
            '<tr>' +
            '<td colspan="8" class="empty">' +
            'No holdings yet. Click "Add Holding" to get started.' +
            '</td>' +
            '</tr>';

        updateSummary([]);

        return;
    }

    table.innerHTML = "";

    holdings.forEach(function(holding) {

        const shares =
            Number(holding.shares);

        const purchasePrice =
            Number(holding.purchase_price);

        const currentPrice =
            holding.current_price === null
                ? null
                : Number(holding.current_price);

        const totalCost =
            shares * purchasePrice;

        const currentValue =
            currentPrice === null
                ? null
                : shares * currentPrice;

        const gainLoss =
            currentValue === null
                ? null
                : currentValue - totalCost;


        let gainLossHTML = "$0.00";

        if (gainLoss !== null) {

            gainLossHTML =
                '<span class="' +
                (gainLoss >= 0
                    ? "gain"
                    : "loss") +
                '">' +
                (gainLoss >= 0 ? "+" : "") +
                "$" +
                Math.abs(gainLoss).toFixed(2) +
                '</span>';

        }


        const row =
            document.createElement("tr");


        row.innerHTML =

            '<td>' +
                '<span class="ticker">' +
                    escapeHTML(holding.ticker) +
                '</span>' +
            '</td>' +

            '<td>' +
                shares.toLocaleString() +
            '</td>' +

            '<td>$' +
                purchasePrice.toFixed(2) +
            '</td>' +

            '<td>' +
                (
                    currentPrice === null
                    ? "Unavailable"
                    : "$" +
                      currentPrice.toFixed(2)
                ) +
            '</td>' +

            '<td>' +
                (
                    currentValue === null
                    ? "Unavailable"
                    : "$" +
                      currentValue.toFixed(2)
                ) +
            '</td>' +

            '<td>' +
                gainLossHTML +
            '</td>' +

            '<td>' +
                escapeHTML(holding.buy_date) +
            '</td>' +

            '<td>' +

                '<button ' +
                    'class="delete-button" ' +
                    'onclick="deleteHolding(' +
                    holding.id +
                    ')">' +
                    'Delete' +
                '</button>' +

            '</td>';


        table.appendChild(row);

    });


    updateSummary(holdings);
}


function updateSummary(holdings) {

    let totalInvested = 0;

    let portfolioValue = 0;

    let totalShares = 0;

    let pricesAvailable = true;


    holdings.forEach(function(holding) {

        const shares =
            Number(holding.shares);

        const purchasePrice =
            Number(holding.purchase_price);

        totalShares += shares;

        totalInvested +=
            shares * purchasePrice;


        if (holding.current_price === null) {

            pricesAvailable = false;

        } else {

            portfolioValue +=
                shares *
                Number(holding.current_price);
        }

    });


    document.getElementById(
        "totalInvested"
    ).textContent =
        "$" +
        totalInvested.toLocaleString(
            undefined,
            {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        );


    document.getElementById(
        "portfolioValue"
    ).textContent =
        pricesAvailable
            ? "$" +
              portfolioValue.toLocaleString(
                  undefined,
                  {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                  }
              )
            : "Unavailable";


    const totalGainLoss =
        pricesAvailable
            ? portfolioValue - totalInvested
            : null;


    const gainLossElement =
        document.getElementById(
            "totalGainLoss"
        );


    if (totalGainLoss === null) {

        gainLossElement.textContent =
            "Unavailable";

        gainLossElement.className =
            "card-value";

    } else {

        gainLossElement.textContent =
            (totalGainLoss >= 0 ? "+" : "") +
            "$" +
            Math.abs(totalGainLoss).toLocaleString(
                undefined,
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            );

        gainLossElement.className =
            "card-value " +
            (totalGainLoss >= 0
                ? "gain"
                : "loss");
    }


    document.getElementById(
        "holdingCount"
    ).textContent =
        holdings.length;


    document.getElementById(
        "totalShares"
    ).textContent =
        totalShares.toLocaleString();
}


function openModal() {

    document.getElementById(
        "modal"
    ).style.display = "flex";

    document.getElementById(
        "ticker"
    ).focus();
}


function closeModal() {

    document.getElementById(
        "modal"
    ).style.display = "none";

    document.getElementById(
        "holdingForm"
    ).reset();

    document.getElementById(
        "formError"
    ).style.display = "none";
}


document
    .getElementById("holdingForm")
    .addEventListener(
        "submit",
        async function(e) {

            e.preventDefault();

            const errorBox =
                document.getElementById(
                    "formError"
                );

            errorBox.style.display =
                "none";


            const ticker =
                document.getElementById(
                    "ticker"
                )
                .value
                .trim()
                .toUpperCase();


            const shares =
                Number(
                    document.getElementById(
                        "shares"
                    ).value
                );


            const purchasePrice =
                Number(
                    document.getElementById(
                        "purchasePrice"
                    ).value
                );


            const buyDate =
                document.getElementById(
                    "buyDate"
                ).value;


            try {

                const response =
                    await fetch(
                        "/api/holdings",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                ticker: ticker,
                                shares: shares,
                                purchasePrice:
                                    purchasePrice,
                                buyDate: buyDate
                            })
                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        result.error ||
                        "Failed to add holding"
                    );
                }


                closeModal();

                loadHoldings();


            } catch (error) {

                errorBox.textContent =
                    error.message;

                errorBox.style.display =
                    "block";
            }

        }
    );


async function deleteHolding(id) {

    if (
        !confirm(
            "Delete this holding?"
        )
    ) {
        return;
    }


    try {

        const response =
            await fetch(
                "/api/holdings/" + id,
                {
                    method: "DELETE"
                }
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.error ||
                "Failed to delete holding"
            );
        }


        loadHoldings();


    } catch (error) {

        alert(error.message);
    }
}


function escapeHTML(value) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


document
    .getElementById("modal")
    .addEventListener(
        "click",
        function(e) {

            if (e.target === this) {
                closeModal();
            }

        }
    );


loadHoldings();

</script>

</body>
</html>`;

        return new Response(HTML, {
            headers: {
                "content-type":
                    "text/html;charset=UTF-8"
            }
        });
    }
};