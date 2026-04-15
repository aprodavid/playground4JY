export const INSTALL_PLACE_CODES = ['A003', 'A022', 'A033'] as const;
export type InstallPlaceCode = (typeof INSTALL_PLACE_CODES)[number];

export const INSTALL_PLACE_LABELS: Record<InstallPlaceCode, string> = {
  A003: '도시공원',
  A022: '박물관',
  A033: '공공도서관',
};
