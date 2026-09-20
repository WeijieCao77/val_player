"""Identity gate for generated biographies, independent of country display."""
from fetch_bios import normalized_birth


def trusted_bio(bio, pid):
    """Never attach a same-handle bio or an unvalidated search hit to a person."""
    if str(bio.get('vlr')) != str(pid):
        return {}
    method = bio.get('matchedBy')
    if method not in ('vlr', 'reviewed-vlr') and not (method == 'search' and bio.get('playerInfoboxVerified') is True):
        return {}
    out = dict(bio)
    out['birth_date'] = normalized_birth(out.get('birth_date'))
    return out
