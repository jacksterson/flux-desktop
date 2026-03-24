import urllib.request, re, json

url = "https://www.untitledui.com/free-icons/weather"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    # find next js data
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if match:
        data = json.loads(match.group(1))
        # Traverse JSON or regex search the raw HTML directly
except Exception as e:
    print(e)

# Direct regex search for any SVG block that contains the typical UntitledUI attributes or just viewBox="0 0 24 24"
svgs = re.findall(r'<svg[^>]* viewBox="0 0 24 24"[^>]*>.*?</svg>', html)
for i, svg in enumerate(svgs[:30]):
    # Try to find a name near it, or just name it icon_i.svg
    with open(f"/home/jack/EWWStranding/assets/icons/weather/icon_{i}.svg", "w") as f:
        f.write(svg.replace('stroke="currentColor"', 'fill="currentColor"'))
print(f"Saved {len(svgs)} SVGs")
