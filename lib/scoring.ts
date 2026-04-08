import { type FacilityDoc, type RideCacheDoc, type SearchResult, type WeightConfig } from '@/types/domain';

export function buildWarnings(f: FacilityDoc, ride: RideCacheDoc): string[] {
  const warnings: string[] = [];
  if (!f.lat || !f.lng) warnings.push('좌표없음');
  if (f.area >= 1000 && ride.filteredCount === 0) warnings.push('대면적-기구0');
  if (f.area <= 120 && ride.filteredCount >= 10) warnings.push('면적-기구 불일치');
  if (ride.status === 'error') warnings.push('ride4 조회오류');
  return warnings;
}

export function scoreFacility(f: FacilityDoc, ride: RideCacheDoc, w: WeightConfig): SearchResult {
  let score = 0;
  const scoreBreakdown: string[] = [];
  const reasons: string[] = [];
  const nowYear = new Date().getFullYear();

  if (f.installYear && nowYear - f.installYear <= 3) {
    score += w.recent3yBonus;
    scoreBreakdown.push(`최근3년 +${w.recent3yBonus}`);
  } else if (f.installYear && nowYear - f.installYear <= 5) {
    score += w.recent5yBonus;
    scoreBreakdown.push(`최근5년 +${w.recent5yBonus}`);
  }

  if (f.area >= 1000) { score += w.area1000; scoreBreakdown.push(`면적>=1000 +${w.area1000}`); }
  else if (f.area >= 600) { score += w.area600; scoreBreakdown.push(`면적>=600 +${w.area600}`); }
  else if (f.area >= 300) { score += w.area300; scoreBreakdown.push(`면적>=300 +${w.area300}`); }

  if (ride.typeCount >= 6) { score += w.type6; scoreBreakdown.push(`기구종류>=6 +${w.type6}`); }
  else if (ride.typeCount >= 4) { score += w.type4; scoreBreakdown.push(`기구종류>=4 +${w.type4}`); }
  else if (ride.typeCount >= 3) { score += w.type3; scoreBreakdown.push(`기구종류>=3 +${w.type3}`); }

  if (ride.filteredCount >= 8) { score += w.ride8; scoreBreakdown.push(`기구개수>=8 +${w.ride8}`); }
  else if (ride.filteredCount >= 5) { score += w.ride5; scoreBreakdown.push(`기구개수>=5 +${w.ride5}`); }

  if (f.isExcellent) {
    score += w.excellentBonus;
    scoreBreakdown.push(`우수시설 +${w.excellentBonus}`);
    reasons.push('우수시설 지정');
  }

  if (ride.typeCount >= 4) reasons.push('기구 종류가 다양함');
  if (f.installYear && nowYear - f.installYear <= 5) reasons.push('비교적 최근 설치');
  if (f.area >= 600) reasons.push('충분한 시설 면적');

  const warnings = buildWarnings(f, ride);
  const recommended = score >= 20 && warnings.length < 2;

  return {
    pfctSn: f.pfctSn,
    facilityName: f.facilityName,
    sido: f.sido,
    sigungu: f.sigungu,
    address: f.address,
    installPlaceCode: f.installPlaceCode,
    installYear: f.installYear,
    area: f.area,
    areaMissing: f.areaMissing,
    isExcellent: f.isExcellent,
    rideTypeCount: ride.typeCount,
    rideCount: ride.filteredCount,
    score,
    scoreBreakdown,
    reasons,
    warnings,
    recommended,
  };
}
