import { health } from "../apps/web/health.mjs";

const expectedKeys = ["status", "liveTrading", "liveOrdersLocked"];

function snapshot() {
  return JSON.stringify(health);
}

const first = snapshot();
const second = snapshot();

if (first !== second) {
  console.error("health smoke is not deterministic");
  process.exit(1);
}

const keys = Object.keys(health);
if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
  console.error("health smoke keys mismatch");
  process.exit(1);
}

if (health.status !== "ok" || health.liveTrading !== "OFF" || health.liveOrdersLocked !== true) {
  console.error("health smoke value mismatch");
  process.exit(1);
}

console.log(first);
console.log("health smoke ok");
