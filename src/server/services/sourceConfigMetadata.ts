export function readSourceConfigChannelAccountMetadata(configJson: Record<string, unknown>) {
  const metadata: Record<string, unknown> = {};
  const channelAccountId = readPositiveInteger(configJson.channelAccountId);
  const accountKey =
    readString(configJson.accountKey) ??
    readString(configJson.channelAccountKey);

  if (channelAccountId !== undefined) {
    metadata.channelAccountId = channelAccountId;
  }

  if (accountKey) {
    metadata.accountKey = accountKey;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function readPositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
