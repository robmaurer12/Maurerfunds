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
