export function allowedActorGuard(actor: Actor, allowedTypes: Actor['type'][]) {
    return allowedTypes.includes(actor.type);
}