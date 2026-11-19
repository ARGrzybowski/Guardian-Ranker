import { getDatabase } from './database.js';
import { delay } from './bungieApi.js';

export async function queueGuardian(membershipId, membershipType) {
  const { data, error } = await getDatabase().rpc('enqueue_guardian', {
    p_membership_id: String(membershipId), p_membership_type: membershipType
  });
  if (error) throw error;
  if (data !== true) throw new Error('The indexing queue is busy. Please try again later.');
}

export async function refreshGuardianScore({ membershipId, membershipType }, signal, onState) {
  const call = async (name, args) => {
    const { data, error } = await getDatabase().rpc(name, args).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw error;
    return data;
  };
  const request = await call('request_guardian_score', { p_membership_id: String(membershipId), p_membership_type: membershipType });
  if (request?.state === 'busy') throw new Error('The score queue is busy. Try again shortly.');
  if (!request?.requestedAt || !request.membershipId) throw new Error('The score refresh could not be queued.');
  const expires = Date.now() + 360000;
  let state = request.state;
  for (let poll = 0; state === 'queued' || state === 'indexing'; poll++) {
    onState(state);
    if (Date.now() >= expires) return { state: 'pending' };
    await delay(poll < 4 ? 2500 : 15000, signal);
    state = await call('get_guardian_score_request', { p_membership_id: request.membershipId, p_requested_at: request.requestedAt });
  }
  return { state: state === 'updated' ? 'updated' : 'unavailable', membershipId: request.membershipId };
}
