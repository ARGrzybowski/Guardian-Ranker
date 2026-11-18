import { getDatabase } from './database.js';

export async function queueGuardian(membershipId, membershipType) {
  const { data, error } = await getDatabase().rpc('enqueue_guardian', {
    p_membership_id: String(membershipId), p_membership_type: membershipType
  });
  if (error) throw error;
  if (data !== true) throw new Error('The indexing queue is busy. Please try again later.');
}
