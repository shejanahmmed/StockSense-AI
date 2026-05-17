import requests, json

BASE = 'http://localhost:8000'
login = requests.post(BASE+'/api/user/login', json={'org_name': 'TestStore', 'industry': 'Electronics', 'password': 'test123'})
token = login.json()['token']

with open('data/raw/sample_multi_product.csv', 'rb') as f:
    r = requests.post(
        BASE+'/api/predict?strategy=balanced&deep_learning=true&region=BD',
        headers={'Authorization': 'Bearer ' + token},
        files={'file': ('sample.csv', f, 'text/csv')},
        timeout=120
    )

print('Predict HTTP status:', r.status_code)
if r.status_code == 200:
    d = r.json()
    print('API status:', d.get('status'))
    print('Products:', len(d.get('products', [])))
    print('KPIs:', json.dumps(d.get('kpis'), indent=2))
    for p in d.get('products', []):
        print(f' - {p.get("product_id")}: {p.get("product_name")} (Stock: {p.get("current_stock")}) -> {p.get("status")}')
else:
    print('ERROR:', r.text[:1200])
