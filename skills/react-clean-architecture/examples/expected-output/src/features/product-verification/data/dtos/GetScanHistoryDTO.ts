export type GetScanHistoryResponseItemDTO = {
    ScanId: number;
    ScanCode: string;
    ScannedAt: string;
    WasValid: boolean;
};

export type GetScanHistoryResponseDTO = GetScanHistoryResponseItemDTO[];
