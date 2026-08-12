export type GetScanHistoryItem = {
    scanId: number;
    scanCode: string | null;
    scannedAt: string | null;
    wasValid: boolean;
};

export type GetScanHistoryResult = GetScanHistoryItem[];

export type GetScanHistoryInput = {
    from: string;
};
