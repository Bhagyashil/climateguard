# ClimateGuard
Know the risk. Act before it happens.

Enter a city and get a heat risk score, a flood risk score, an overall level
(LOW / MEDIUM / HIGH / CRITICAL) and clear safety recommendations.

## Run locally
```
npm start          # serves the project on http://localhost:3000
```
Open http://localhost:3000/frontend/

Without Node: `python3 -m http.server 3000` from this folder, then open the same URL.

## Test
```
npm test
```

## Roadmap
Frontend → risk engine → weather data → AWS (S3, CloudFront, API Gateway, Lambda, DynamoDB, CloudWatch) → Docker → GitHub Actions → Terraform.
