import type { Env } from "../index";

/*
 * Pengaturan program yang HANYA boleh dibuat/diubah oleh Owner.
 * Disimpan di tabel program_settings (JSON). Tidak ada nilai yang
 * di-hardcode di logika: semua aturan dibaca dari sini, dengan nilai
 * bawaan hanya dipakai bila Owner belum pernah menyimpan pengaturan.
 */
export type MemberRules = {
  enabled: boolean;
  bonusEveryCoins: number; // setiap kelipatan N koin dibeli -> bonus
  bonusCoins: number; // jumlah koin bonus per kelipatan
  bagAtCoins: number; // setiap kelipatan N koin dibeli -> 1 laundry bag, lalu siklus mulai ulang
};

export type ProgramSettings = {
  member: MemberRules;
  dropoff: { estimateHours: number };
};

export const DEFAULT_PROGRAM_SETTINGS: ProgramSettings = {
  member: { enabled: true, bonusEveryCoins: 10, bonusCoins: 1, bagAtCoins: 40 },
  dropoff: { estimateHours: 24 },
};

function intIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= min && n <= max ? n : null;
}

/** Validasi + normalisasi input Owner. Mengembalikan pesan error bila tidak valid. */
export function sanitizeProgramSettings(
  input: unknown,
): { ok: true; value: ProgramSettings } | { ok: false; message: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Data pengaturan tidak valid." };
  }
  const raw = input as { member?: Record<string, unknown>; dropoff?: Record<string, unknown> };
  const m = raw.member ?? {};
  const d = raw.dropoff ?? {};

  const bonusEveryCoins = intIn(m.bonusEveryCoins, 1, 1000);
  const bonusCoins = intIn(m.bonusCoins, 1, 100);
  const bagAtCoins = intIn(m.bagAtCoins, 1, 10000);
  const estimateHours = intIn(d.estimateHours, 1, 720);

  if (bonusEveryCoins === null) return { ok: false, message: "Kelipatan koin bonus harus angka 1–1000." };
  if (bonusCoins === null) return { ok: false, message: "Jumlah koin bonus harus angka 1–100." };
  if (bagAtCoins === null) return { ok: false, message: "Target laundry bag harus angka 1–10000." };
  if (estimateHours === null) return { ok: false, message: "Estimasi drop-off harus 1–720 jam." };
  if (bagAtCoins < bonusEveryCoins) {
    return { ok: false, message: "Target laundry bag tidak boleh lebih kecil dari kelipatan koin bonus." };
  }

  return {
    ok: true,
    value: {
      member: { enabled: m.enabled === true, bonusEveryCoins, bonusCoins, bagAtCoins },
      dropoff: { estimateHours },
    },
  };
}

export async function readProgramSettings(env: Env): Promise<ProgramSettings> {
  try {
    const row = await env.DB.prepare(`
      SELECT data_json FROM program_settings WHERE id = 1 LIMIT 1
    `).first<{ data_json: string }>();
    if (row?.data_json) {
      const parsed = sanitizeProgramSettings(JSON.parse(row.data_json));
      if (parsed.ok) return parsed.value;
    }
  } catch {
    // tabel belum ada / JSON rusak -> pakai bawaan
  }
  return DEFAULT_PROGRAM_SETTINGS;
}

/**
 * Tampilan progres siklus. Total koin dibeli tidak pernah direset (riwayat
 * tetap utuh); "siklus" yang ditampilkan ke customer otomatis mulai dari 0
 * lagi setiap mencapai kelipatan bagAtCoins.
 */
export function cycleView(total: number, rules: MemberRules) {
  const bag = Math.max(1, rules.bagAtCoins);
  const every = Math.max(1, rules.bonusEveryCoins);
  const cycleCoins = total % bag;
  return {
    totalCoinsPurchased: total,
    cycleNumber: Math.floor(total / bag) + 1,
    cycleCoins,
    coinsToNextBonus: every - (total % every),
    coinsToBag: bag - cycleCoins,
    bonusesEarned: Math.floor(total / every),
    bagsEarned: Math.floor(total / bag),
  };
}

export type RewardMilestone = {
  type: "BONUS_COIN" | "LAUNDRY_BAG";
  /** Total koin dibeli (absolut, seumur hidup) saat reward ini jatuh tempo. */
  milestone: number;
  /** Jumlah koin bonus (BONUS_COIN) atau 1 (LAUNDRY_BAG). */
  quantity: number;
};

/**
 * Reward yang jatuh tempo ketika total koin dibeli naik dari oldTotal ke newTotal.
 * Murni (tanpa DB) supaya mudah diuji: hasilnya sama baik total naik 1 koin
 * maupun 500 koin dalam satu transaksi.
 */
export function rewardMilestones(oldTotal: number, newTotal: number, rules: MemberRules): RewardMilestone[] {
  if (!rules.enabled || newTotal <= oldTotal) return [];
  const out: RewardMilestone[] = [];
  const every = Math.max(1, rules.bonusEveryCoins);
  const bag = Math.max(1, rules.bagAtCoins);
  for (let i = Math.floor(oldTotal / every) + 1; i <= Math.floor(newTotal / every); i++) {
    out.push({ type: "BONUS_COIN", milestone: i * every, quantity: rules.bonusCoins });
  }
  for (let i = Math.floor(oldTotal / bag) + 1; i <= Math.floor(newTotal / bag); i++) {
    out.push({ type: "LAUNDRY_BAG", milestone: i * bag, quantity: 1 });
  }
  return out;
}
