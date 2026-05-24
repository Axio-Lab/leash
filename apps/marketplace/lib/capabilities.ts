export type CapabilityCountInput = {
  source?: 'leash' | 'pay-skills';
  tools?: Array<unknown>;
  endpoints?: Array<unknown>;
  endpoint_count?: number;
};

export function capabilityCount(item: CapabilityCountInput): number {
  const endpoints =
    typeof item.endpoint_count === 'number' && Number.isFinite(item.endpoint_count)
      ? Math.max(0, Math.floor(item.endpoint_count))
      : null;
  if (endpoints != null) return Math.max(1, endpoints);
  if (item.endpoints && item.endpoints.length > 0) return item.endpoints.length;
  return Math.max(1, item.tools?.length ?? 0);
}

export function capabilityCountLabel(item: CapabilityCountInput): string {
  const count = capabilityCount(item);
  return `${count} capabilit${count === 1 ? 'y' : 'ies'}`;
}

export function capabilityCountHint(item: CapabilityCountInput): string {
  const count = capabilityCount(item);
  if (item.source === 'pay-skills') {
    return `${count} payable endpoint${count === 1 ? '' : 's'}`;
  }
  if ((item.endpoints?.length ?? 0) > 0) {
    return `${count} payable endpoint${count === 1 ? '' : 's'}`;
  }
  if ((item.tools?.length ?? 0) > 0) {
    return `${count} callable tool${count === 1 ? '' : 's'}`;
  }
  return '1 service endpoint';
}

export function paySkillsProviderPath(fqn: string): string {
  const path = fqn
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `/api/pay-skills/${path}`;
}
