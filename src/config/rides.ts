export const RIDE_WHITELIST = [
  'D001','D002','D003','D004','D005','D006','D007','D008','D009',
  'D020','D021','D022','D080','D050','D052',
] as const;

export const RIDE_NAME_MAP: Record<(typeof RIDE_WHITELIST)[number], string> = {
  D001: '그네', D002: '미끄럼틀', D003: '시소', D004: '회전놀이기구', D005: '흔들놀이기구',
  D006: '복합놀이대', D007: '정글짐', D008: '오르는기구', D009: '건너는기구',
  D020: '조합놀이대', D021: '그물놀이기구', D022: '트램폴린', D080: '짚라인',
  D050: '모래놀이', D052: '물놀이',
};
