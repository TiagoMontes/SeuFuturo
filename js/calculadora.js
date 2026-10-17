"use strict";
const $ = (id) => document.getElementById(id);
const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const decimals = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const defaults = {
  initial: 0,
  monthly: 1000,
  growthMode: "percent",
  growthRate: 10,
  growthAmount: 100,
  rate: 8,
  rateUnit: "annual",
  years: 20,
  inflation: 4,
  goal: 1000000,
  goalMode: "nominal",
  timing: "end",
  delay: 5,
};
let latest = null;
let previousUnit = "annual";
let chartMode = "inflation";
function money(v) {
  return currency.format(Math.abs(v) < 0.005 ? 0 : v);
}
function percent(v) {
  return pct.format(Math.abs(v) < 0.000000001 ? 0 : v * 100) + "%";
}
function parseMoney(value) {
  let s = String(value).trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}
function equivalentMonthly(rate, unit) {
  return unit === "annual" ? Math.expm1(Math.log1p(rate) / 12) : rate;
}
function factor(rate, n, timing) {
  const ordinary =
    Math.abs(rate) < 1e-14 ? n : Math.expm1(n * Math.log1p(rate)) / rate;
  return ordinary * (timing === "begin" ? 1 + rate : 1);
}
function futureValue(initial, monthly, rate, n, timing) {
  return (
    initial * Math.exp(n * Math.log1p(rate)) + monthly * factor(rate, n, timing)
  );
}
// These measures compare the same balance in future and present-day currency.
// Erosion is not a cash debit, nor is it nominal investment profit/loss.
function inflationMeasures(balance, annualInflation, month) {
  const logFactor = (Math.log1p(annualInflation) * month) / 12;
  const inflationFactor = Math.exp(logFactor);
  const real = balance / inflationFactor;
  return {
    real,
    inflationFactor,
    erosion: balance - real,
    erosionShare: -Math.expm1(-logFactor),
    inflationAccum: Math.expm1(logFactor),
  };
}
// Every monthly deposit is linear in the first-year monthly contribution.
// Rates supplied to this pure API are fractions (0.10 means 10%).
function contributionParts(p, month) {
  const completedYears = Math.max(0, Math.floor((month - 1) / 12));
  return p.growthMode === "fixed"
    ? { multiplier: 1, extra: (p.growthAmount || 0) * completedYears }
    : {
        multiplier: Math.pow(1 + (p.growthRate || 0), completedYears),
        extra: 0,
      };
}
function contributionAt(p, month, firstYearMonthly = p.monthly) {
  const part = contributionParts(p, month);
  return firstYearMonthly * part.multiplier + part.extra;
}
function growBalance(balance, deposit, r, timing) {
  return timing === "begin"
    ? (balance + deposit) * (1 + r)
    : balance * (1 + r) + deposit;
}
function project(p, r, n, waitMonths = 0) {
  let balance = p.initial,
    invested = p.initial;
  const rows = [
    {
      month: 0,
      year: 0,
      start: p.initial,
      deposit: 0,
      monthInterest: 0,
      balance,
      invested,
      interest: 0,
      ...inflationMeasures(balance, p.inflation, 0),
    },
  ];
  for (let month = 1; month <= n; month++) {
    const start = balance,
      active = month > waitMonths;
    const deposit = active ? contributionAt(p, month) : 0;
    const monthInterest = active
      ? (balance + (p.timing === "begin" ? deposit : 0)) * r
      : 0;
    if (active) balance = growBalance(balance, deposit, r, p.timing);
    invested += deposit;
    rows.push({
      month,
      year: Math.ceil(month / 12),
      start,
      deposit,
      monthInterest,
      balance,
      invested,
      interest: balance - invested,
      ...inflationMeasures(balance, p.inflation, month),
    });
  }
  return { rows, last: rows[n] };
}
function goalContributionTerms(p, r, n) {
  let unit = 0,
    extra = 0;
  for (let month = 1; month <= n; month++) {
    const part = contributionParts(p, month);
    unit = growBalance(unit, part.multiplier, r, p.timing);
    extra = growBalance(extra, part.extra, r, p.timing);
  }
  return { unit, extra };
}
function simulate(params) {
  const p = {
    growthMode: "percent",
    growthRate: 0,
    growthAmount: 0,
    ...params,
    goalMode: params.goalMode || "nominal",
  };
  const r = equivalentMonthly(p.rate, p.rateUnit),
    n = p.years * 12;
  const annualReturn = Math.expm1(12 * Math.log1p(r));
  const realAnnualReturn = Math.expm1(
    12 * Math.log1p(r) - Math.log1p(p.inflation),
  );
  const { rows, last } = project(p, r, n);
  const baseline = project(
    { ...p, growthMode: "percent", growthRate: 0, growthAmount: 0 },
    r,
    n,
  );
  rows.forEach((row, index) => {
    row.fixedBalance = baseline.rows[index].balance;
  });
  const waitMonths = p.delay * 12;
  // Waiting removes deposits before the start, but does not reset the salary-growth calendar.
  const delayedProjection = project(p, r, n, waitMonths);
  const delayed = delayedProjection.last.balance;
  const missedDeposits = rows
    .slice(1, waitMonths + 1)
    .reduce((sum, row) => sum + row.deposit, 0);
  const goalFuture =
    p.goal * (p.goalMode === "real" ? last.inflationFactor : 1);
  const goalToday = goalFuture / last.inflationFactor;
  const terms = goalContributionTerms(p, r, n);
  const initialFuture = p.initial * Math.exp(n * Math.log1p(r));
  const requiredRaw = Math.max(
    0,
    (goalFuture - initialFuture - terms.extra) / terms.unit,
  );
  const required = Math.ceil(requiredRaw * 100) / 100;
  const requiredLast = contributionAt(p, n, required);
  const hit = rows.findIndex(
    (row) =>
      row.balance >=
      p.goal * (p.goalMode === "real" ? row.inflationFactor : 1) - 1e-8,
  );
  const extraDeposits = last.invested - baseline.last.invested;
  const extraInterest = last.interest - baseline.last.interest;
  const growthDifference = last.balance - baseline.last.balance;
  if (
    ![
      last.balance,
      last.real,
      delayed,
      required,
      goalFuture,
      growthDifference,
    ].every(Number.isFinite)
  ) {
    throw new Error(
      "Os valores excederam o limite de cálculo. Reduza o prazo ou as taxas.",
    );
  }
  return {
    p,
    r,
    n,
    annualReturn,
    realAnnualReturn,
    rows,
    last,
    baseline,
    delayed,
    delayedProjection,
    missedDeposits,
    required,
    requiredLast,
    requiredRaw,
    hit,
    goalFuture,
    goalToday,
    extraDeposits,
    extraInterest,
    growthDifference,
  };
}
function readInputs() {
  const growthMode = $("growthMode").value;
  const p = {
    initial: parseMoney($("initial").value),
    monthly: parseMoney($("monthly").value),
    growthMode,
    growthRate:
      growthMode === "percent" ? Number($("growthRate").value) / 100 : 0,
    growthAmount:
      growthMode === "fixed" ? parseMoney($("growthAmount").value) : 0,
    rate: Number($("rate").value) / 100,
    rateUnit: $("rateUnit").value,
    years: Number($("years").value),
    inflation: Number($("inflation").value) / 100,
    goal: parseMoney($("goal").value),
    goalMode: $("goalMode").value,
    timing: $("timing").value,
    delay: Number($("delay").value),
  };
  for (const k of [
    "rate",
    "years",
    "inflation",
    "delay",
    growthMode === "percent" ? "growthRate" : "growthAmount",
  ])
    if ($(k).value.trim() === "")
      throw new Error("Preencha todos os campos para simular.");
  if (
    Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v))
  )
    throw new Error(
      "Confira os valores: use apenas números. Exemplo de valor: 1.000,00.",
    );
  if (!["percent", "fixed"].includes(p.growthMode))
    throw new Error("Escolha um tipo de aumento do aporte.");
  if (p.initial < 0 || p.monthly < 0 || p.initial > 1e9 || p.monthly > 1e9)
    throw new Error(
      "Valor inicial e aporte inicial devem ficar entre R$ 0 e R$ 1 bilhão.",
    );
  if (p.growthRate < 0 || p.growthRate > 1)
    throw new Error(
      "O aumento percentual do aporte deve ficar entre 0% e 100% ao ano.",
    );
  if (p.growthAmount < 0 || p.growthAmount > 1e9)
    throw new Error(
      "O aumento anual em reais deve ficar entre R$ 0 e R$ 1 bilhão.",
    );
  if (p.goal <= 0 || p.goal > 1e12)
    throw new Error("A meta deve ser maior que zero e de até R$ 1 trilhão.");
  if (!Number.isInteger(p.years) || p.years < 1 || p.years > 50)
    throw new Error("Escolha um prazo de 1 a 50 anos inteiros.");
  if (p.rate <= -1 || p.rate > 1)
    throw new Error(
      "Informe uma taxa maior que −100% e de até 100% no período escolhido.",
    );
  if (p.inflation < 0 || p.inflation > 1)
    throw new Error("A inflação deve estar entre 0% e 100% ao ano.");
  if (!Number.isInteger(p.delay) || p.delay < 0 || p.delay > p.years)
    throw new Error(
      "A espera deve ser de zero até o prazo total, em anos inteiros.",
    );
  return p;
}
function syncGrowthControls() {
  const fixed = $("growthMode").value === "fixed";
  $("growth-percent-fields").hidden = fixed;
  $("growth-fixed-fields").hidden = !fixed;
  $("growthRate").disabled = fixed;
  $("growthAmount").disabled = !fixed;
}
function growthDescription(p) {
  if ((p.growthMode === "fixed" ? p.growthAmount : p.growthRate) === 0)
    return "Sem reajuste";
  return p.growthMode === "fixed"
    ? `+ ${money(p.growthAmount)} a cada ano`
    : `+ ${percent(p.growthRate)} ao ano`;
}
function renderGrowth(data) {
  const p = data.p;
  $("growth-badge").textContent = growthDescription(p);
  const years = [...new Set([1, 2, 3, p.years])].filter(
    (year) => year <= p.years,
  );
  $("growth-milestones").style.setProperty(
    "--milestone-count",
    String(years.length),
  );
  $("growth-milestones").innerHTML = years
    .map(
      (year) =>
        `<div class="milestone"><span>Ano ${year}</span><strong>${money(contributionAt(p, (year - 1) * 12 + 1))}</strong><small>por mês · meses ${(year - 1) * 12 + 1}–${year * 12}</small></div>`,
    )
    .join("");
  $("growth-preview").textContent =
    p.years === 1
      ? "Prazo de 1 ano: o reajuste só teria efeito a partir do 13º mês."
      : `Ano 1: ${money(p.monthly)}/mês → ano 2: ${money(contributionAt(p, 13))}/mês.`;
  $("growth-inflation-note").textContent =
    p.growthMode === "fixed"
      ? "O aumento é no valor mensal, não um depósito extra anual. A inflação não é somada automaticamente."
      : "Reajuste nominal: a inflação não é somada automaticamente. Não altera a taxa de rendimento.";
  document
    .querySelectorAll("[data-growth]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(
          p.growthMode === "percent" &&
            Math.abs(Number(b.dataset.growth) / 100 - p.growthRate) < 1e-10,
        ),
      ),
    );
  document
    .querySelectorAll("[data-growth-amount]")
    .forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(
          p.growthMode === "fixed" &&
            Math.abs(Number(b.dataset.growthAmount) - p.growthAmount) < 1e-10,
        ),
      ),
    );
  $("fixed-balance").textContent = money(data.baseline.last.balance);
  $("growing-balance").textContent = money(data.last.balance);
  $("growth-gain").textContent =
    Math.abs(data.growthDifference) < 0.005
      ? "Os dois cenários terminam com o mesmo saldo."
      : `${money(data.growthDifference)} a mais no saldo final.`;
  $("growth-breakdown").textContent =
    `Diferença: ${money(data.extraDeposits)} em depósitos adicionais e ${money(data.extraInterest)} pelo efeito dos rendimentos.`;
  $("growth-real").textContent =
    `O aumento de saldo equivale a ${money(data.growthDifference / data.last.inflationFactor)} em dinheiro de hoje. Mesmo prazo e rendimento; muda apenas o aporte.`;
}
function compact(v) {
  const av = Math.abs(v);
  if (av >= 1e12) return pct.format(v / 1e12) + " tri";
  if (av >= 1e9) return pct.format(v / 1e9) + " bi";
  if (av >= 1e6) return pct.format(v / 1e6) + " mi";
  if (av >= 1e3) return pct.format(v / 1e3) + " mil";
  return pct.format(v);
}
function axis(v) {
  return "R$ " + compact(v);
}
function drawChart(data) {
  const inflation = chartMode === "inflation",
    growth = chartMode === "growth";
  const secondary = inflation ? "real" : growth ? "fixedBalance" : "invested";
  const W = 760,
    H = 300,
    left = 90,
    right = 26,
    top = 24,
    bottom = 44;
  const pw = W - left - right,
    ph = H - top - bottom;
  const annual = data.rows.filter((row) => row.month % 12 === 0);
  const max =
    Math.max(...annual.map((row) => Math.max(row.balance, row[secondary])), 1) *
    1.12;
  const x = (month) => left + (month / data.n) * pw;
  const y = (value) => top + ph - (value / max) * ph;
  const path = (key) =>
    annual
      .map(
        (row, i) =>
          (i === 0 ? "M" : "L") +
          x(row.month).toFixed(2) +
          "," +
          y(row[key]).toFixed(2),
      )
      .join(" ");
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = (max * i) / 4,
      yy = y(val);
    grid += `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e5ecec"/><text x="${left - 13}" y="${yy + 4}" text-anchor="end" fill="#61717d" font-size="11">${axis(val)}</text>`;
  }
  const ticks = Math.min(5, data.p.years);
  for (let i = 0; i <= ticks; i++) {
    const yr = (data.p.years * i) / ticks,
      xx = x(yr * 12);
    grid += `<text x="${xx}" y="${H - 17}" text-anchor="middle" fill="#61717d" font-size="11">${pct.format(yr)} ${yr === 1 ? "ano" : "anos"}</text>`;
  }
  const line = path("balance");
  const area =
    inflation || growth
      ? line +
        " " +
        [...annual]
          .reverse()
          .map(
            (row) =>
              "L" +
              x(row.month).toFixed(2) +
              "," +
              y(row[secondary]).toFixed(2),
          )
          .join(" ") +
        " Z"
      : line + ` L${x(data.n)},${top + ph} L${left},${top + ph} Z`;
  const secondaryColor = inflation ? "#b57930" : "#476be2";
  const title = inflation
    ? `Saldo nominal e poder de compra ao longo de ${data.p.years} anos`
    : growth
      ? `Saldo com e sem aumento anual do aporte ao longo de ${data.p.years} anos`
      : `Saldo nominal e total depositado ao longo de ${data.p.years} anos`;
  const desc = inflation
    ? `Ao final, saldo nominal de ${money(data.last.balance)}, equivalente a ${money(data.last.real)} em dinheiro de hoje. Diferença na conversão: ${money(data.last.erosion)}. Não é uma retirada da conta.`
    : growth
      ? `Com o reajuste escolhido, saldo de ${money(data.last.balance)}; mantendo o aporte inicial, saldo de ${money(data.baseline.last.balance)}. Ambos nominais. A diferença inclui dinheiro adicional depositado e rendimentos.`
      : `Ao final, saldo de ${money(data.last.balance)}, com ${money(data.last.invested)} depositados, em valores nominais.`;
  $("chart-inflation").setAttribute("aria-pressed", String(inflation));
  $("chart-contributions").setAttribute(
    "aria-pressed",
    String(chartMode === "contributions"),
  );
  $("chart-growth").setAttribute("aria-pressed", String(growth));
  $("chart-legend").innerHTML = inflation
    ? '<span><i></i>Saldo nominal</span><span><i class="real"></i>Poder de compra em reais de hoje</span>'
    : growth
      ? '<span><i></i>Com o reajuste escolhido</span><span><i class="baseline"></i>Mantendo o aporte inicial</span>'
      : '<span><i></i>Saldo com rendimentos</span><span><i class="invested"></i>Dinheiro depositado</span>';
  $("chart-caption").textContent = inflation
    ? "As duas linhas mostram o mesmo patrimônio: o valor na conta e seu equivalente em dinheiro de hoje. A área entre elas evidencia a corrosão do poder de compra, não um débito no investimento."
    : growth
      ? "Os dois cenários usam o mesmo prazo, valor inicial e rendimento. A diferença inclui depósitos adicionais e seus rendimentos. Valores nominais; não é toda composta por juros."
      : "Ambas as linhas estão em valores nominais. A diferença entre elas representa os rendimentos acumulados. O total depositado já inclui os reajustes anuais do aporte.";
  $("chart").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">${title}</title><desc id="chart-desc">${desc} Os valores detalhados estão na tabela anual.</desc><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${inflation ? "#d29853" : "#087d65"}" stop-opacity=".18"/><stop offset="100%" stop-color="${inflation ? "#d29853" : "#087d65"}" stop-opacity=".035"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#area)"/><path d="${line}" fill="none" stroke="#087d65" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="${path(secondary)}" fill="none" stroke="${secondaryColor}" stroke-width="2.5" stroke-dasharray="7 5"/><circle cx="${x(data.n)}" cy="${y(data.last.balance)}" r="4.5" fill="#087d65" stroke="white" stroke-width="2"/><circle cx="${x(data.n)}" cy="${y(data.last[secondary])}" r="4" fill="${secondaryColor}" stroke="white" stroke-width="2"/></svg>`;
}
function duration(months) {
  const years = Math.floor(months / 12),
    m = months % 12;
  return (
    [
      years ? years + " " + (years === 1 ? "ano" : "anos") : "",
      m ? m + " " + (m === 1 ? "mês" : "meses") : "",
    ]
      .filter(Boolean)
      .join(" e ") || "no início"
  );
}
function update() {
  syncGrowthControls();
  try {
    const p = readInputs(),
      data = simulate(p);
    const { last, r, delayed, required, hit, realAnnualReturn } = data;
    latest = data;
    $("error").hidden = true;
    $("results").style.opacity = "1";
    $("csv").disabled = false;
    $("rate-equivalent").textContent =
      p.rateUnit === "annual"
        ? `Equivale a ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(r * 100)}% ao mês. Taxa efetiva nominal.`
        : `Equivale a ${percent(data.annualReturn)} ao ano. Taxa efetiva nominal.`;
    $("context").textContent =
      `Ao final de ${p.years} ${p.years === 1 ? "ano" : "anos"}, seu saldo estimado seria`;
    $("balance").textContent = money(last.balance);
    $("invested").textContent = money(last.invested);
    $("interest").textContent = money(last.interest);
    renderGrowth(data);
    $("real-balance").textContent = money(last.real);
    $("inflation-caption").textContent =
      `Hipótese: ${percent(p.inflation)} ao ano`;
    $("erosion-amount").textContent = money(last.erosion);
    $("erosion-caption").textContent =
      p.inflation === 0
        ? "Sem corrosão nesta hipótese."
        : `${percent(last.erosionShare)} de redução do poder de compra por real.`;
    $("power-retained").style.width = 100 / last.inflationFactor + "%";
    $("power-eroded").style.width = 100 * last.erosionShare + "%";
    $("power-caption").textContent =
      `Cada R$ 100 no fim do prazo teriam o poder de compra de ${money(100 / last.inflationFactor)} de hoje.`;
    $("cumulative-inflation").textContent = percent(last.inflationAccum);
    $("real-rate").textContent = percent(realAnnualReturn);
    $("real-rate").classList.toggle("negative", realAnnualReturn < -1e-10);
    $("inflation-example").textContent =
      `Algo que custa R$ 100 hoje custaria ${money(100 * last.inflationFactor)} ao final do prazo, seguindo esta inflação.`;
    $("return-verdict").textContent =
      realAnnualReturn > 1e-10
        ? "Nesta hipótese, o rendimento supera a inflação, antes de impostos e taxas."
        : realAnnualReturn < -1e-10
          ? "Nesta hipótese, o rendimento não acompanha a inflação. Novos aportes ainda podem aumentar seu patrimônio."
          : "Nesta hipótese, o rendimento apenas acompanha a inflação, antes de impostos e taxas.";
    $("return-verdict").classList.toggle("negative", realAnnualReturn < -1e-10);
    document
      .querySelectorAll("[data-inflation]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(
            Math.abs(Number(b.dataset.inflation) / 100 - p.inflation) < 1e-10,
          ),
        ),
      );
    const earnedShare =
      last.balance > 0 && last.interest > 0
        ? (last.interest / last.balance) * 100
        : 0;
    $("principal-bar").style.width = 100 - earnedShare + "%";
    $("interest-bar").style.width = earnedShare + "%";
    $("composition-note").textContent =
      last.interest >= 0
        ? `${pct.format(earnedShare)}% do saldo final viria dos rendimentos nominais.`
        : "Nesta hipótese, o saldo final é menor que o total depositado.";
    $("delay-title").textContent =
      p.delay === 0
        ? "Comparando o mesmo ponto de partida"
        : `E se começar daqui a ${p.delay} ${p.delay === 1 ? "ano" : "anos"}?`;
    $("now-balance").textContent = money(last.balance);
    $("later-balance").textContent = money(delayed);
    const rawDifference = last.balance - delayed;
    const difference = Math.abs(rawDifference) < 0.005 ? 0 : rawDifference;
    $("delay-cost").textContent = money(Math.abs(difference));
    $("delay-description").textContent =
      difference >= 0
        ? "a menos no saldo nominal final ao adiar."
        : "a mais no saldo nominal ao adiar, neste cenário de perdas.";
    $("delay-breakdown").textContent =
      `Diferença: ${money(data.missedDeposits)} em depósitos não feitos e ${money(difference - data.missedDeposits)} em rendimentos.`;
    $("delay-real").textContent =
      `Em dinheiro de hoje, a diferença equivale a ${money(Math.abs(difference) / last.inflationFactor)} ${difference >= 0 ? "a menos" : "a mais"} ao adiar.`;
    $("goal-hint").textContent =
      p.goalMode === "real"
        ? "A meta cresce com a inflação para preservar o poder de compra informado."
        : "Meta nominal: valor na conta na data futura, sem reajuste pela inflação.";
    $("goal-title").textContent = `Sua meta: ${money(p.goal)}`;
    $("goal-timeline").textContent =
      hit === 0
        ? "Você já começa alcançando essa meta."
        : hit < 0
          ? "Com este plano de aportes, a meta não é alcançada dentro do prazo."
          : `Com este plano de aportes, a meta é alcançada pela primeira vez em ${duration(hit)}${p.goalMode === "real" ? ", já considerando a inflação" : ""}.`;
    const progress = (last.balance / data.goalFuture) * 100;
    $("goal-progress").style.width = Math.max(0, Math.min(100, progress)) + "%";
    $("goal-percent").textContent =
      `O saldo final equivale a ${pct.format(progress)}% da meta${p.goalMode === "real" ? " corrigida pela inflação" : ""}.`;
    $("required-monthly").textContent = money(required) + "/mês";
    $("required-description").textContent =
      `Aporte mensal no primeiro ano para chegar ${p.goalMode === "real" ? "ao poder de compra desejado" : "à meta nominal"} em ${p.years} ${p.years === 1 ? "ano" : "anos"}, com o reajuste escolhido.`;
    $("goal-note").textContent =
      required === 0
        ? "O aporte mensal necessário no primeiro ano é zero nesta hipótese. Isso não elimina os reajustes futuros em reais, quando houver."
        : required <= p.monthly
          ? "Seu aporte inicial, com os reajustes escolhidos, é suficiente para atingir a meta no final desta simulação."
          : `No primeiro ano, isso representa ${money(required - p.monthly)} a mais por mês do que seu aporte inicial.`;
    $("goal-contribution-explanation").textContent =
      p.years === 1
        ? "Este é o aporte mensal total necessário, não um valor extra. Não há reajuste dentro de um prazo de apenas 12 meses."
        : `Este é o aporte mensal inicial total, não um valor extra. Depois: ${growthDescription(p).toLowerCase()}. Com esse aporte inicial calculado, no ano ${p.years} seriam ${money(data.requiredLast)} por mês.`;
    $("goal-basis-explanation").textContent =
      p.goalMode === "real"
        ? `Para ter o poder de compra de ${money(p.goal)} de hoje, a meta de saldo no fim do prazo seria ${money(data.goalFuture)}.`
        : `Essa meta nominal teria o poder de compra de ${money(data.goalToday)} de hoje. Em “Meta e outros ajustes”, selecione “Poder de compra de hoje” para preservar o valor desejado.`;
    $("year-rows").innerHTML = data.rows
      .filter((row) => row.month % 12 === 0)
      .map(
        (row) =>
          `<tr><td>${row.month === 0 ? "Início" : row.month / 12}</td><td>${row.month === 0 ? "—" : money(row.deposit)}</td><td>${money(row.invested)}</td><td>${money(row.interest)}</td><td>${money(row.balance)}</td><td>${money(row.real)}</td><td>${money(row.erosion)}</td></tr>`,
      )
      .join("");
    drawChart(data);
  } catch (err) {
    $("error").textContent = err.message;
    $("error").hidden = false;
    $("results").style.opacity = ".32";
    $("csv").disabled = true;
    latest = null;
  }
}
function capDelay() {
  const years = Number($("years").value);
  if (Number.isInteger(years) && years >= 1 && years <= 50) {
    $("delay").max = String(years);
    if (Number($("delay").value) > years) $("delay").value = String(years);
  }
}
$("form").addEventListener("submit", (e) => e.preventDefault());
for (const id of ["initial", "monthly", "goal", "growthAmount"]) {
  $(id).addEventListener("input", update);
  $(id).addEventListener("blur", () => {
    const val = parseMoney($(id).value);
    if (Number.isFinite(val)) $(id).value = decimals.format(val);
    update();
  });
}
for (const id of ["rate", "years", "inflation", "delay", "growthRate"])
  $(id).addEventListener("input", () => {
    if (id === "years") capDelay();
    update();
  });
for (const id of ["timing", "goalMode", "growthMode"])
  $(id).addEventListener("change", update);
$("rateUnit").addEventListener("change", () => {
  const newUnit = $("rateUnit").value,
    rate = Number($("rate").value) / 100;
  if (Number.isFinite(rate) && rate > -1 && newUnit !== previousUnit) {
    const converted =
      newUnit === "monthly"
        ? Math.expm1(Math.log1p(rate) / 12)
        : Math.expm1(12 * Math.log1p(rate));
    $("rate").value = String(Number((converted * 100).toFixed(8)));
  }
  previousUnit = newUnit;
  update();
});
document.querySelectorAll("[data-monthly]").forEach((b) =>
  b.addEventListener("click", () => {
    $("monthly").value = decimals.format(Number(b.dataset.monthly));
    update();
  }),
);
document.querySelectorAll("[data-years]").forEach((b) =>
  b.addEventListener("click", () => {
    $("years").value = b.dataset.years;
    capDelay();
    update();
  }),
);
document.querySelectorAll("[data-inflation]").forEach((b) =>
  b.addEventListener("click", () => {
    $("inflation").value = b.dataset.inflation;
    update();
  }),
);
$("chart-inflation").addEventListener("click", () => {
  chartMode = "inflation";
  if (latest) drawChart(latest);
});
$("chart-contributions").addEventListener("click", () => {
  chartMode = "contributions";
  if (latest) drawChart(latest);
});
$("chart-growth").addEventListener("click", () => {
  chartMode = "growth";
  if (latest) drawChart(latest);
});
document.querySelectorAll("[data-growth]").forEach((b) =>
  b.addEventListener("click", () => {
    $("growthMode").value = "percent";
    $("growthRate").value = b.dataset.growth;
    update();
  }),
);
document.querySelectorAll("[data-growth-amount]").forEach((b) =>
  b.addEventListener("click", () => {
    $("growthMode").value = "fixed";
    $("growthAmount").value = decimals.format(Number(b.dataset.growthAmount));
    update();
  }),
);
$("reset").addEventListener("click", () => {
  for (const [id, value] of Object.entries(defaults))
    $(id).value = ["initial", "monthly", "goal", "growthAmount"].includes(id)
      ? decimals.format(value)
      : String(value);
  previousUnit = "annual";
  chartMode = "inflation";
  capDelay();
  update();
});
// CSV keeps nominal and inflation-adjusted amounts explicitly separate.
function buildCSV(data) {
  const p = data.p,
    decimal = (v) => Number(v).toFixed(2).replace(".", ",");
  return [
    [
      "SIMULAÇÃO DE JUROS COMPOSTOS, INFLAÇÃO E APORTES CRESCENTES — VALORES EM R$",
    ],
    [
      "Hipóteses: taxas constantes, reajuste anual do aporte a partir do mês 13, juros reinvestidos, sem impostos ou taxas",
    ],
    [
      "Diferença pela inflação: comparação entre saldo nominal e reais de hoje; não é débito na conta",
    ],
    ["Valor inicial", decimal(p.initial)],
    ["Aporte mensal no primeiro ano", decimal(p.monthly)],
    [
      "Tipo de aumento anual do aporte",
      p.growthMode === "fixed"
        ? "Acréscimo em reais ao aporte mensal"
        : "Percentual sobre o aporte anterior",
    ],
    [
      "Aumento anual (%)",
      p.growthMode === "percent"
        ? decimal(p.growthRate * 100)
        : "Não se aplica",
    ],
    [
      "Acréscimo anual ao aporte mensal (R$)",
      p.growthMode === "fixed" ? decimal(p.growthAmount) : "Não se aplica",
    ],
    [
      "Primeiro reajuste",
      "Mês 13; depois, a cada 12 meses. Inflação não é somada automaticamente.",
    ],
    [
      "Comparação de espera",
      "Os aportes após a espera seguem o calendário original de reajustes.",
    ],
    ["Taxa informada (%)", (p.rate * 100).toFixed(8).replace(".", ",")],
    [
      "Período da taxa",
      p.rateUnit === "annual" ? "Anual efetiva" : "Mensal efetiva",
    ],
    ["Prazo (anos)", p.years],
    ["Inflação anual (%)", decimal(p.inflation * 100)],
    ["Depósito", p.timing === "begin" ? "Início do mês" : "Fim do mês"],
    ["Rendimento real anual (%)", decimal(data.realAnnualReturn * 100)],
    ["Aporte inicial mensal necessário para a meta", decimal(data.required)],
    ["Aporte mensal no último ano para a meta", decimal(data.requiredLast)],
    [
      "Saldo final mantendo o aporte inicial",
      decimal(data.baseline.last.balance),
    ],
    ["Depósitos adicionais devido aos reajustes", decimal(data.extraDeposits)],
    ["Efeito dos reajustes sobre os rendimentos", decimal(data.extraInterest)],
    [
      "Base da meta",
      p.goalMode === "real"
        ? "Poder de compra de hoje"
        : "Valor nominal futuro",
    ],
    ["Meta informada", decimal(p.goal)],
    ["Meta nominal ao final do prazo", decimal(data.goalFuture)],
    [],
    [
      "Mês",
      "Ano",
      "Saldo inicial nominal (R$)",
      "Aporte nominal (R$)",
      "Juros nominais do mês (R$)",
      "Saldo final nominal (R$)",
      "Total depositado nominal (R$)",
      "Juros nominais acumulados (R$)",
      "Saldo em reais de hoje (R$)",
      "Diferença pela inflação (R$)",
      "Redução de poder de compra por real (%)",
      "Inflação acumulada (%)",
      "Saldo mantendo o aporte inicial (R$)",
    ],
    ...data.rows.map((row) => [
      row.month,
      row.year,
      ...[
        row.start,
        row.deposit,
        row.monthInterest,
        row.balance,
        row.invested,
        row.interest,
        row.real,
        row.erosion,
        row.erosionShare * 100,
        row.inflationAccum * 100,
        row.fixedBalance,
      ].map(decimal),
    ]),
  ]
    .map((row) =>
      row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(";"),
    )
    .join("\r\n");
}
$("csv").addEventListener("click", () => {
  if (!latest) return;
  const blob = new Blob(["\uFEFF" + buildCSV(latest)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "evolucao_aportes_juros_e_inflacao.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
});
window.compoundCalculator = {
  simulate,
  futureValue,
  equivalentMonthly,
  parseMoney,
  factor,
  inflationMeasures,
  buildCSV,
  contributionAt,
  contributionParts,
  goalContributionTerms,
  project,
};
update();
