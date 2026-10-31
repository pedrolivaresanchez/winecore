// The Timbal gateway may or may not strip the /api prefix before the request reaches this process.
export function withoutApiPrefix(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return request;
  url.pathname = url.pathname.slice('/api'.length) || '/';
  return new Request(url.toString(), request);
}
