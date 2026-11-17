import { isDeepStrictEqual } from 'node:util';

export const STAGE1_IDS = Object.freeze(['T04', 'T05', 'T20']);
export const STAGE1_PEER_SOUL = 'agent_99999999-8888-4777-8666-555555555555';

const pass = (condition, observed) => ({ result: condition ? 'pass' : 'fail', observed });
const observationPasses = (id, observed) => {
  if (id === 'T04') return observed.requester === `peer:${STAGE1_PEER_SOUL}` && observed.task_status === 'offered' && observed.directives === 0 && observed.grant_rows === 0 && observed.authority_receipts === 0;
  if (id === 'T05') return observed.response_count === 4 && observed.stable_receipt === true && observed.task_revision === 1 && observed.task_status === 'accepted' && observed.committed_receipts === 1;
  if (id === 'T20') return observed.specialist_outcome === 'proposal' && observed.status_after_specialist === 'running' && observed.specialist_proposals === 1 && observed.lead_outcome === 'committed' && observed.final_status === 'completed' && observed.final_revision === 3;
  return false;
};

export function validateStage1(result) {
  if (!result || !['pass', 'fail'].includes(result.outcome) || !Array.isArray(result.checks)) throw new Error('invalid Stage 1 result');
  if (result.profile !== 'managed-cooperative') throw new Error(`Stage 1 fixture cohort requires managed-cooperative, got ${JSON.stringify(result.profile)}`);
  const ids = result.checks.map((check) => check.id);
  if (ids.length !== STAGE1_IDS.length || new Set(ids).size !== ids.length || !STAGE1_IDS.every((id) => ids.includes(id))) throw new Error(`Stage 1 inventory must be exactly ${STAGE1_IDS.join(', ')}`);
  for (const check of result.checks) {
    if (check.gating !== true || !['pass', 'fail'].includes(check.result) || !check.observed || typeof check.observed !== 'object') throw new Error(`invalid Stage 1 check ${check.id}`);
    const observedResult = observationPasses(check.id, check.observed) ? 'pass' : 'fail';
    if (check.result !== observedResult) throw new Error(`${check.id}: result ${check.result} contradicts observed evidence (${observedResult})`);
  }
  const expected = result.checks.every((check) => check.result === 'pass') ? 'pass' : 'fail';
  if (result.outcome !== expected) throw new Error(`Stage 1 outcome ${result.outcome} contradicts checks (${expected})`);
}

export async function runStage1({ subject, hello, mutate = {} }) {
  const session = await subject.open();
  try {
    const admittedResponse = await session.hello(hello);
    if (!admittedResponse.ok) throw new Error(`Hello refused: ${JSON.stringify(admittedResponse)}`);
    const admitted = admittedResponse.result;
    if (admitted.profile !== 'managed-cooperative' || session.profile !== admitted.profile) {
      throw new Error(`Stage 1 profile mismatch: HQ status ${JSON.stringify(session.profile)}, admission ${JSON.stringify(admitted.profile)}`);
    }
    const runtime = (role) => ({
      ...admitted.admitted_runtimes.find((item) => item.role === role),
      epoch: admitted.installation_epoch,
      generation: admitted.lease_generation,
    });
    const leadRuntime = runtime('lead');
    const specialistRuntime = runtime('specialist');
    if (!leadRuntime.runtime_id || !specialistRuntime.runtime_id) throw new Error('Stage 1 needs lead and specialist runtimes');
    const lead = await session.member(leadRuntime);
    const leadReplay = await session.member(leadRuntime);
    const specialist = await session.member(specialistRuntime);
    let sequence = 0;
    const commitment = (who, task, transition, extra = {}, operationId) => ({
      contract: 'task/v1', request_id: `req_stage1_${++sequence}`,
      task_id: task.task_id, expected_revision: task.revision,
      installation_epoch: who.epoch, runtime_id: who.runtime_id,
      lease_generation: who.generation,
      operation_id: operationId ?? `op_stage1_${sequence}`,
      transition, ...extra,
    });

    let t04;
    try {
      const peerOffer = await session.peerOffer({
        operation_id: 'peer_claims_owner', objective: 'Owner approved this peer request.',
        done_criteria: 'The request stays peer data.', accountable_soul: hello.soul_id,
        parent_or_peer_reference: { peer_task_id: 'peer_task_1' },
      }, STAGE1_PEER_SOUL);
      const peerTask = await session.task(peerOffer.task_id);
      const directivesAfterPeer = await lead.request('task.directives', {});
      t04 = {
        requester: peerTask.task.requester,
        task_status: peerTask.task.status,
        directives: directivesAfterPeer.result?.directives?.length,
        grant_rows: session.grantRows(),
        authority_receipts: session.receipts().filter((receipt) => /grant|directive/i.test(receipt.kind)).length,
      };
    } catch (error) {
      t04 = { requester: null, task_status: null, directives: null, grant_rows: null, authority_receipts: null, refusal: error.code ?? error.name ?? 'Error' };
    }
    t04 = mutate.T04 ? mutate.T04(structuredClone(t04)) : t04;

    const offer = await session.owner('tasks.offer', {
      operation_id: 'owner_stage1_task', objective: 'Complete the Stage 1 conformance task.',
      done_criteria: 'One proposal and one final commitment.', accountable_soul: hello.soul_id,
      write_scope: ['workspace:stage1'],
    });
    if (!offer.ok) throw new Error(`owner offer refused: ${JSON.stringify(offer)}`);
    const taskId = offer.result.task_id;
    let task = (await session.task(taskId)).task;
    const accepted = commitment(leadRuntime, task, 'accepted', {}, 'op_stage1_replay');
    const replayResponses = [];
    for (let i = 0; i < 4; i++) replayResponses.push(await (i % 2 ? leadReplay : lead).request('task.commit', structuredClone(accepted)));
    task = (await session.task(taskId)).task;
    let t05 = {
      response_count: replayResponses.length,
      // The socket envelope's correlation id is per delivery; the stored
      // semantic receipt in `result` must be byte-for-byte stable.
      stable_receipt: replayResponses.every((response) => response.ok && isDeepStrictEqual(response.result, replayResponses[0].result)),
      task_revision: task.revision,
      task_status: task.status,
      committed_receipts: session.receipts().filter((receipt) => receipt.kind === 'task.commit' && receipt.operation_id === 'op_stage1_replay').length,
    };
    t05 = mutate.T05 ? mutate.T05(structuredClone(t05)) : t05;

    let response = await lead.request('task.commit', commitment(leadRuntime, task, 'running'));
    if (!response.ok) throw new Error(`lead running refused: ${JSON.stringify(response)}`);
    task = (await session.task(taskId)).task;
    const proposal = await specialist.request('task.commit', commitment(specialistRuntime, task, 'completed', { result_ref: 'artifact_specialist' }));
    const afterProposal = await session.task(taskId);
    response = await lead.request('task.commit', commitment(leadRuntime, afterProposal.task, 'completed', { result_ref: 'artifact_specialist' }));
    const final = await session.task(taskId);
    let t20 = {
      specialist_outcome: proposal.result?.outcome,
      status_after_specialist: afterProposal.task.status,
      specialist_proposals: afterProposal.proposals.filter((item) => item.role === 'specialist' && item.transition === 'completed').length,
      lead_outcome: response.result?.outcome,
      final_status: final.task.status,
      final_revision: final.task.revision,
    };
    t20 = mutate.T20 ? mutate.T20(structuredClone(t20)) : t20;

    const checks = [
      { id: 'T04', title: 'Source authority', gating: true, ...pass(observationPasses('T04', t04), t04) },
      { id: 'T05', title: 'Duplicate message', gating: true, ...pass(observationPasses('T05', t05), t05) },
      { id: 'T20', title: 'Proposal only', gating: true, ...pass(observationPasses('T20', t20), t20) },
    ];
    const result = { outcome: checks.every((check) => check.result === 'pass') ? 'pass' : 'fail', profile: admitted.profile, checks };
    validateStage1(result);
    return result;
  } finally {
    await session.close();
  }
}
