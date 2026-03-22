/**
 * Resolves a token, actor, or {x,y} position to a canvas center point.
 * For actors, uses the first active token on the currently viewed scene.
 */
function resolvePoint(target) {
  // Raw position
  if (target?.x !== undefined && target?.y !== undefined && !(target.documentName)) {
    return { x: target.x, y: target.y };
  }

  // TokenDocument or Token placeable
  const token =
    target?.documentName === "Token" ? target :       // TokenDocument
    target?.document?.documentName === "Token" ? target.document :  // Token placeable
    target?.documentName === "Actor" ? target.getActiveTokens(true, true)[0] :  // Actor
    null;

  if (!token) return null;

  // Center of token
  return {
    x: token.x + (token.width * canvas.grid.size) / 2,
    y: token.y + (token.height * canvas.grid.size) / 2,
  };
}

/**
 * Returns all TokenDocuments on the current scene within a given distance of a source.
 *
 * @param {Token|TokenDocument|Actor|{x:number,y:number}} source
 * @param {number} distance - Maximum distance in scene units (feet).
 * @returns {TokenDocument[]} Tokens within range, excluding the source token itself.
 */
export function targetsWithin(source, distance) {
  const from = resolvePoint(source);
  if (!from) return [];

  const sourceToken =
    source?.documentName === "Token" ? source :
    source?.document?.documentName === "Token" ? source.document :
    source?.documentName === "Actor" ? source.getActiveTokens(true, true)[0] : null;

  return canvas.scene.tokens.filter((token) => {
    if (sourceToken && token.id === sourceToken.id) return false;
    const to = resolvePoint(token);
    if (!to) return false;
    return canvas.grid.measurePath([from, to]).distance <= distance;
  });
}

/**
 * Returns the distance between two targets in the scene's configured units (feet by default).
 *
 * @param {Token|TokenDocument|Actor|{x:number,y:number}} a
 * @param {Token|TokenDocument|Actor|{x:number,y:number}} b
 * @returns {number|null} Distance in scene units, or null if either target can't be resolved.
 */
export function measureDistance(a, b) {
  const from = resolvePoint(a);
  const to = resolvePoint(b);
  if (!from || !to) return null;

  return canvas.grid.measurePath([from, to]).distance;
}
