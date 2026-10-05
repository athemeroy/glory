"""Keep browser QA on the explicitly selected loopback server only."""
from urllib.parse import urlsplit


def confine_to_local(context, base_url):
    base = urlsplit(base_url)
    if base.scheme not in ('http', 'https') or base.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Browser QA requires a loopback URL')
    expected = (base.scheme, base.netloc)
    blocked = []

    def route_local(route):
        request = urlsplit(route.request.url)
        if (request.scheme, request.netloc) == expected:
            route.continue_()
        else:
            blocked.append(route.request.url)
            route.abort('blockedbyclient')

    context.route('**/*', route_local)
    return blocked
