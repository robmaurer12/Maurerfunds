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

    loadCash();
    loadDailyChange();
    loadChart(currentRange);
}


let holdingCache = [];


async function loadCash() {

    const el = document.getElementById("cashAvailable");

    if (!el) {
        return;
    }

    try {
        const response = await fetch("/api/cash");

        if (!response.ok) {
            throw new Error("Failed to load cash");
        }

        const data = await response.json();

        renderCash(Number(data.cash) || 0);
    } catch (error) {
        renderCash(0);
    }
}


function renderCash(cash) {

    const el = document.getElementById("cashAvailable");

    if (!el) {
        return;
    }

    const sign = cash < 0 ? "-" : "";
    el.textContent =
        sign +
        "$" +
        Math.abs(cash).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

    el.classList.toggle("negative", cash < 0);
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

                '<div class="row-actions">' +

                    '<button ' +
                        'class="sell-button" ' +
                        'onclick="openSellModalById(' +
                        holding.id +
                        ')">' +
                        'Sell' +
                    '</button>' +

                    '<button ' +
                        'class="delete-button" ' +
                        'onclick="deleteHolding(' +
                        holding.id +
                        ')">' +
                        'Delete' +
                    '</button>' +

                '</div>' +

            '</td>';


        table.appendChild(row);

    });


    holdingCache = holdings;

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


async function loadDailyChange() {

    const el = document.getElementById("dailyChange");

    try {
        const response = await fetch("/api/daily-change");

        if (!response.ok) {
            throw new Error("Failed to load daily change");
        }

        const data = await response.json();

        setDailyChange(
            Number(data.totalDailyChange) || 0,
            Number(data.totalDailyChangePct) || 0
        );
    } catch (error) {
        el.textContent = "--";
        el.classList.remove("positive", "negative");
        el.classList.add("neutral");
    }
}


function setDailyChange(change, changePct) {

    const el = document.getElementById("dailyChange");

    const sign = change > 0 ? "+" : change < 0 ? "-" : "";
    const absChange = Math.abs(change).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const absPct = Math.abs(changePct).toFixed(2);

    el.textContent = `${sign}$${absChange} (${sign}${absPct}%)`;

    el.classList.remove("positive", "negative", "neutral");

    if (change > 0) {
        el.classList.add("positive");
    } else if (change < 0) {
        el.classList.add("negative");
    } else {
        el.classList.add("neutral");
    }
}


let portfolioChart = null;

let currentRange = "3m";

const CHART_RANGES = {
    "1m": { limit: 30, days: 30 },
    "3m": { limit: 90, days: 90 },
    "6m": { limit: 180, days: 180 },
    "1y": { limit: 365, days: 365 }
};


async function loadChart(range = "3m") {

    const canvas = document.getElementById("portfolioChart");

    if (!canvas || typeof Chart === "undefined") {
        return;
    }

    const config = CHART_RANGES[range] || CHART_RANGES["3m"];

    try {
        const response = await fetch(
            `/api/portfolio/candles?interval=1d&limit=${config.limit}`
        );

        if (!response.ok) {
            throw new Error("Failed to load chart data");
        }

        const series = await response.json();

        const cutoff = Date.now() - config.days * 24 * 60 * 60 * 1000;

        const points = (Array.isArray(series) ? series : []).filter(
            point => point && point.timestamp >= cutoff
        );

        if (points.length === 0) {
            renderChart(["Start", "Now"], [0, 0], range);
            return;
        }

        const labels = points.map(point =>
            new Date(point.timestamp).toLocaleDateString()
        );
        const values = points.map(point => point.value);

        renderChart(labels, values, range);
    } catch (error) {
        renderChart(["Start", "Now"], [0, 0], range);
    }
}


function renderChart(labels, values, range) {

    const canvas = document.getElementById("portfolioChart");

    if (!canvas || typeof Chart === "undefined") {
        return;
    }

    if (portfolioChart) {
        portfolioChart.destroy();
        portfolioChart = null;
    }

    portfolioChart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Portfolio Value",
                    data: values,
                    borderColor: "#111827",
                    backgroundColor: "rgba(17, 24, 39, 0.08)",
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: context =>
                            "$" +
                            Number(context.parsed.y).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                            })
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 8
                    }
                },
                y: {
                    ticks: {
                        callback: value =>
                            "$" + Number(value).toLocaleString()
                    }
                }
            }
        }
    });
}


function initTabs() {

    const tabs = document.getElementById("tabs");

    if (!tabs) {
        return;
    }

    tabs.addEventListener("click", event => {

        const button = event.target.closest(".tab-button");

        if (!button) {
            return;
        }

        const target = button.dataset.tab;

        tabs.querySelectorAll(".tab-button").forEach(btn => {
            btn.classList.toggle("active", btn === button);
        });

        document.querySelectorAll(".tab-panel").forEach(panel => {
            panel.classList.toggle(
                "active",
                panel.id === "tab-" + target
            );
        });

        if (target === "portfolio" && portfolioChart) {
            portfolioChart.resize();
        }

        if (target === "history") {
            loadHistory();
        }
    });
}


async function loadHistory() {

    const table = document.getElementById("historyTable");

    if (!table) {
        return;
    }

    try {
        const response = await fetch("/api/transactions");

        if (!response.ok) {
            throw new Error("Failed to load history");
        }

        const data = await response.json();

        renderHistory(data.transactions || []);
    } catch (error) {
        table.innerHTML =
            '<tr>' +
            '<td colspan="6" class="empty">' +
            "Unable to load history." +
            "</td>" +
            "</tr>";
    }
}


function renderHistory(transactions) {

    const table = document.getElementById("historyTable");

    if (!table) {
        return;
    }

    if (!transactions.length) {
        table.innerHTML =
            '<tr>' +
            '<td colspan="6" class="empty">' +
            "No transactions yet." +
            "</td>" +
            "</tr>";
        return;
    }

    table.innerHTML = transactions
        .map(transaction => {

            const type = String(transaction.type || "").toUpperCase();
            const isBuy = type === "BUY";
            const isSell = type === "SELL";

            let ticker = transaction.ticker || "-";
            let shares = "-";
            let price = "-";
            let total = "-";

            if (isBuy || isSell) {
                shares = Number(transaction.shares).toLocaleString();
                price = formatCurrency(transaction.price);
                total = formatCurrency(
                    Number(transaction.shares) *
                        Number(transaction.price)
                );
            } else {
                total = formatCurrency(transaction.amount);
            }

            return (
                "<tr>" +
                "<td>" +
                escapeHTML(transaction.date) +
                "</td>" +
                '<td><span class="badge ' +
                type.toLowerCase() +
                '">' +
                escapeHTML(type) +
                "</span></td>" +
                "<td>" +
                escapeHTML(ticker) +
                "</td>" +
                "<td>" +
                escapeHTML(shares) +
                "</td>" +
                "<td>" +
                escapeHTML(price) +
                "</td>" +
                "<td>" +
                escapeHTML(total) +
                "</td>" +
                "</tr>"
            );
        })
        .join("");
}


function formatCurrency(value) {

    const number = Number(value) || 0;
    const sign = number < 0 ? "-" : "";

    return (
        sign +
        "$" +
        Math.abs(number).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        })
    );
}


function initRangeSelector() {

    const selector = document.getElementById("rangeSelector");

    if (!selector) {
        return;
    }

    selector.addEventListener("click", event => {

        const button = event.target.closest(".range-button");

        if (!button) {
            return;
        }

        selector
            .querySelectorAll(".range-button")
            .forEach(btn => btn.classList.remove("active"));

        button.classList.add("active");

        currentRange = button.dataset.range;

        loadChart(currentRange);
    });
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


function todayISO() {

    const now = new Date();
    const local = new Date(
        now.getTime() - now.getTimezoneOffset() * 60000
    );

    return local.toISOString().slice(0, 10);
}


function openSellModalById(holdingId) {

    const holding = holdingCache.find(
        item => Number(item.id) === Number(holdingId)
    );

    if (!holding) {
        return;
    }

    const price =
        holding.current_price != null
            ? Number(holding.current_price)
            : Number(holding.purchase_price) || 0;

    const modal = document.getElementById("sellModal");

    document.getElementById("sellTicker").textContent = holding.ticker;
    document.getElementById("sellMax").textContent = Number(
        holding.shares
    ).toLocaleString();

    document.getElementById("sellForm").dataset.holdingId = holdingId;

    document.getElementById("sellShares").value = "";
    document.getElementById("sellShares").max = holding.shares;
    document.getElementById("sellPrice").value = price;
    document.getElementById("sellDate").value = todayISO();

    document.getElementById(
        "sellError"
    ).style.display = "none";

    modal.style.display = "flex";

    document.getElementById("sellShares").focus();
}


function closeSellModal() {

    document.getElementById(
        "sellModal"
    ).style.display = "none";

    document.getElementById("sellForm").reset();

    document.getElementById(
        "sellError"
    ).style.display = "none";
}


function openCashModal() {

    document.getElementById(
        "cashModal"
    ).style.display = "flex";

    document.getElementById(
        "cashDate"
    ).value = todayISO();

    document.getElementById(
        "cashAmount"
    ).focus();
}


function closeCashModal() {

    document.getElementById(
        "cashModal"
    ).style.display = "none";

    document.getElementById("cashForm").reset();

    document.getElementById(
        "cashError"
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


document
    .getElementById("sellModal")
    .addEventListener(
        "click",
        function(e) {

            if (e.target === this) {
                closeSellModal();
            }

        }
    );


document
    .getElementById("cashModal")
    .addEventListener(
        "click",
        function(e) {

            if (e.target === this) {
                closeCashModal();
            }

        }
    );


document
    .getElementById("sellForm")
    .addEventListener(
        "submit",
        async function(e) {

            e.preventDefault();

            const errorBox = document.getElementById("sellError");

            errorBox.style.display = "none";

            const holdingId = Number(this.dataset.holdingId);
            const shares = Number(
                document.getElementById("sellShares").value
            );
            const price = Number(
                document.getElementById("sellPrice").value
            );
            const date = document.getElementById("sellDate").value;

            try {
                const response = await fetch("/api/sell", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        holdingId,
                        shares,
                        price,
                        date
                    })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.error || "Failed to sell"
                    );
                }

                closeSellModal();

                loadHoldings();
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.style.display = "block";
            }

        }
    );


document
    .getElementById("cashForm")
    .addEventListener(
        "submit",
        async function(e) {

            e.preventDefault();

            const errorBox = document.getElementById("cashError");

            errorBox.style.display = "none";

            const type = document.getElementById("cashType").value;
            const amount = Number(
                document.getElementById("cashAmount").value
            );
            const date = document.getElementById("cashDate").value;

            try {
                const response = await fetch("/api/cash", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        type,
                        amount,
                        date
                    })
                });

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.error || "Failed to save cash"
                    );
                }

                closeCashModal();

                loadCash();
            } catch (error) {
                errorBox.textContent = error.message;
                errorBox.style.display = "block";
            }

        }
    );


initTabs();

initRangeSelector();

loadHoldings();
