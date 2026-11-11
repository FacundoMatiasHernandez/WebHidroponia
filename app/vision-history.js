const captureTarget = (entry) => entry?.captureTarget === "screen" ? "screen" : "plant";

function retainHistory(history, limit = 40) {
  const kept = new Set();
  for (const target of ["plant", "screen"]) {
    history.filter((entry) => captureTarget(entry) === target).slice(-limit).forEach((entry) => kept.add(entry));
  }
  return history.filter((entry) => kept.has(entry));
}

function historyForTarget(vision, target) {
  const history = (vision?.history || []).filter((entry) => captureTarget(entry) === target);
  const latest = vision?.latest && captureTarget(vision.latest) === target
    ? vision.latest : history[history.length - 1] || null;
  return { latest, history };
}

module.exports = { captureTarget, retainHistory, historyForTarget };
