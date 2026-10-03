function renderOwnerMetrics() {
  const data = ownerData?.metrics;
  const target = $("ownerMetrics");
  if (!target || !data) return;

  const totalRewardSupplied = Number(data.totalRewardSupplied || 0);
  const claimed = Number(data.claimed || 0);
  const redeemed = Number(data.redeemed || 0);
  const percentOfSupply = (value) => (totalRewardSupplied > 0 ? Math.round((value / totalRewardSupplied) * 100) : 0);
  const ops = ownerData?.ops || {};
  const fmt = (value) => Number(value || 0).toLocaleString("id-ID");

  // Ikon tambahan khusus Overview Owner (kendaraan & keranjang)
  const common = 'viewBox="0 0 24 24" aria-hidden="true"';
  const extraIcons = {
    truck: `<svg ${common}><path d="M1 5h13v11H1zM14 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>`,
    basket: `<svg ${common}><path d="M3 10h18l-1.6 9.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8z"/><path d="M7.5 10 11 4M16.5 10 13 4M9 14v3M12 14v3M15 14v3"/></svg>`,
  };
  const iconSvg = (name) => extraIcons[name] || ownerIconSvg(name);

  const items = [
    { label: "Total Customer", value: data.participants, icon: "user", percentage: data.participantsChangePct, vsPrevious: true, action: "customers" },
    { label: "Total Member", value: data.members, icon: "customer", action: "members" },
    { label: "Reward Program", value: data.programPending, icon: "gift", action: "customers" },
    { kind: "reward-event", label: "Reward Event", icon: "gift", action: "event-reward" },
    { label: "Request Antar/Jemput", value: ops.deliveryNew, icon: "truck" },
    { label: "Antrean Washer", value: ops.washerWaiting, icon: "washer" },
    { label: "Antrean Dryer", value: ops.dryerWaiting, icon: "dryer" },
    { label: "Drop-off Aktif", value: ops.dropoffActive, icon: "basket" },
  ];
  const ariaByAction = {
    customers: "Lihat daftar customer",
    members: "Lihat daftar member",
    "event-reward": "Lihat detail reward event aktif",
  };

  target.innerHTML = items.map((item) => {
    const actionAttr = item.action
      ? ` data-owner-metric-action="${item.action}" role="button" tabindex="0" aria-label="${ariaByAction[item.action]}"`
      : "";

    if (item.kind === "reward-event") {
      return `<div class="owner-metric-card owner-metric-reward-event clickable"${actionAttr}>
        <span class="owner-metric-icon gift">${iconSvg("gift")}</span>
        <small>${item.label}</small>
        <div class="owner-reward-split">
          <div class="owner-reward-split-col"><strong>${fmt(claimed)}</strong><span>Claimed</span><em>${percentOfSupply(claimed)}%</em></div>
          <i class="owner-reward-split-divider" aria-hidden="true"></i>
          <div class="owner-reward-split-col"><strong>${fmt(redeemed)}</strong><span>Redeemed</span><em>${percentOfSupply(redeemed)}%</em></div>
        </div>
        <span class="owner-metric-note">dari total reward event</span>
      </div>`;
    }

    const hasPercentage = item.percentage !== null && item.percentage !== undefined;
    const numericPercentage = Number(item.percentage || 0);
    const percentageText = hasPercentage ? `${Math.abs(numericPercentage)}%` : "";
    const note = hasPercentage && item.vsPrevious ? `<span class="owner-metric-note">vs sebelumnya</span>` : "";
    return `<div class="owner-metric-card${item.action ? " clickable" : ""}"${actionAttr}><span class="owner-metric-icon ${item.icon}">${iconSvg(item.icon)}</span><small>${item.label}</small><b>${fmt(item.value)}</b>${percentageText ? `<em>${percentageText}</em>` : ""}${note}</div>`;
  }).join("");

  const actions = {
    customers: () => openOwnerCustomerTrace("all"),
    members: () => openOwnerCustomerTrace("member"),
    "event-reward": () => openOwnerActiveEventRewardDetail(),
  };
  target.querySelectorAll("[data-owner-metric-action]").forEach((card) => {
    const run = actions[card.dataset.ownerMetricAction];
    if (!run) return;
    card.onclick = run;
    card.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        run();
      }
    };
  });
}
