/**
 * Risk history stored in DynamoDB.
 * Table: partition key `place` (String), sort key `checkedAt` (String, ISO time).
 * The AWS SDK v3 is built into the Lambda Node.js runtime, so nothing to install.
 * If HISTORY_TABLE is not set (local runs, tests), history is simply skipped.
 */
const TTL_DAYS = 30;

let doc;
function client() {
  if (!doc) {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
    doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return doc;
}

function placeKey(place) {
  return [place.name, place.region].filter(Boolean).join(", ").toLowerCase();
}

async function save(place, entry) {
  const table = process.env.HISTORY_TABLE;
  if (!table) return;
  const { PutCommand } = require("@aws-sdk/lib-dynamodb");
  await client().send(
    new PutCommand({
      TableName: table,
      Item: {
        place: placeKey(place),
        ...entry,
        // DynamoDB deletes the row after this time (enable TTL on `expiresAt`).
        expiresAt: Math.floor(Date.now() / 1000) + TTL_DAYS * 24 * 3600,
      },
    })
  );
}

async function list(place, limit = 10) {
  const table = process.env.HISTORY_TABLE;
  if (!table) return [];
  const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
  const out = await client().send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "#p = :p",
      ExpressionAttributeNames: { "#p": "place" },
      ExpressionAttributeValues: { ":p": placeKey(place) },
      ScanIndexForward: false, // newest first
      Limit: limit,
    })
  );
  return (out.Items || []).map(({ checkedAt, overall, heatScore, floodScore, heatLevel, floodLevel, temperature, rainPast24 }) => ({
    checkedAt, overall, heatScore, floodScore, heatLevel, floodLevel, temperature, rainPast24,
  }));
}

module.exports = { save, list, placeKey };