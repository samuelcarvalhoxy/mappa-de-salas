export type RequestResponseStatistics = {
  sampleSize: number;
  averageMinutes: number;
  medianMinutes: number;
  percentile85Minutes: number;
  standardDeviationMinutes: number;
  meanDeviationMinutes: number;
};

function friendlyRound(minutes: number) {
  const step = minutes <= 60 ? 5 : minutes <= 240 ? 15 : 30;
  return Math.max(step, Math.ceil(minutes / step) * step);
}

export function estimateResponseMinutes(
  statistics: RequestResponseStatistics,
) {
  if (statistics.sampleSize < 5) return null;
  const spread = Math.max(
    0,
    statistics.standardDeviationMinutes,
    statistics.meanDeviationMinutes,
  );
  const upperTypical = Math.max(
    statistics.medianMinutes + statistics.meanDeviationMinutes,
    statistics.averageMinutes + spread * 0.5,
    statistics.percentile85Minutes,
  );
  if (!Number.isFinite(upperTypical) || upperTypical <= 0) return null;
  return friendlyRound(Math.min(upperTypical, 7 * 24 * 60));
}

export function responseDurationLabel(minutes: number) {
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} hora${hours === 1 ? "" : "s"}`;
  return `${hours}h${String(remainder).padStart(2, "0")}`;
}
