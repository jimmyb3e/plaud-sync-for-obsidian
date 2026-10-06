export function normalizePlaudApiDomain(domain: string): string {
	const parsed = parseHttpsUrl(domain, 'Plaud API domain');
	const host = parsed.hostname.toLowerCase();

	if (!isAllowedPlaudApiHost(host)) {
		throw new Error('Plaud API domain must use a plaud.ai API host.');
	}

	if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) {
		throw new Error('Plaud API domain must be a base https:// host without path, credentials, port, query, or fragment.');
	}

	return parsed.origin;
}

export function normalizeSignedContentUrl(url: string): string {
	const parsed = parseHttpsUrl(url, 'Signed content URL');

	if (parsed.username || parsed.password) {
		throw new Error('Signed content URL must not include embedded credentials.');
	}

	const host = parsed.hostname.toLowerCase();
	if (isBlockedLocalHost(host)) {
		throw new Error('Signed content URL must not target a local or private host.');
	}

	return parsed.toString();
}

function parseHttpsUrl(value: string, label: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw new Error(`${label} must be a valid https:// URL.`);
	}

	if (parsed.protocol !== 'https:') {
		throw new Error(`${label} must use https://.`);
	}

	return parsed;
}

function isAllowedPlaudApiHost(host: string): boolean {
	return host === 'api.plaud.ai' || /^api[-.][a-z0-9-]+\.plaud\.ai$/.test(host);
}

function isBlockedLocalHost(host: string): boolean {
	const normalized = host.replace(/^\[|\]$/g, '');

	if (
		normalized === 'localhost'
		|| normalized.endsWith('.localhost')
		|| normalized.endsWith('.local')
		|| normalized === '0.0.0.0'
		|| normalized === '::'
		|| normalized === '::1'
	) {
		return true;
	}

	if (isPrivateIpv4(normalized)) {
		return true;
	}

	return isPrivateIpv6(normalized);
}

function isPrivateIpv4(host: string): boolean {
	const parts = host.split('.');
	if (parts.length !== 4) {
		return false;
	}

	const octets = parts.map((part) => Number.parseInt(part, 10));
	if (octets.some((octet, index) => !/^\d+$/.test(parts[index] ?? '') || octet < 0 || octet > 255)) {
		return false;
	}

	const [first = 0, second = 0] = octets;
	return first === 10
		|| first === 127
		|| (first === 169 && second === 254)
		|| (first === 172 && second >= 16 && second <= 31)
		|| (first === 192 && second === 168);
}

function isPrivateIpv6(host: string): boolean {
	const normalized = host.toLowerCase();
	return normalized.startsWith('fc')
		|| normalized.startsWith('fd')
		|| normalized.startsWith('fe80:')
		|| normalized.startsWith('::ffff:127.')
		|| normalized.startsWith('::ffff:10.')
		|| normalized.startsWith('::ffff:192.168.');
}
