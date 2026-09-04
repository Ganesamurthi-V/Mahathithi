/**
 * Diagnose (and optionally repair) Railway's GitHub auto-deploy.
 *
 * THE PROBLEM THIS FOUND
 * Pushing to main stopped deploying. The service still LOOKS connected — its
 * `source.repo` is "Ganesamurthi-V/Mahathithi", which is what the dashboard shows —
 * but the object that actually reacts to a push is a separate DeploymentTrigger, and
 * the service has none. Without it Railway never receives, or never acts on, the
 * push event. `source.repo` alone only tells Railway WHERE to build from when
 * something asks it to build; it does not subscribe to anything.
 *
 * Evidence:
 *   repoTriggers            -> 0 edges
 *   latest deployments      -> branch: "", commitHash: "" (CLI uploads, not git)
 *   deployment b07f760      -> branch: "main", commitHash: b07f760…, author set
 *                              i.e. GitHub deploys did work until that point
 *
 * Usage:
 *   npx tsx scripts/railway-repo-trigger.ts            # diagnose only
 *   npx tsx scripts/railway-repo-trigger.ts --fix      # recreate the trigger
 *
 * The token is read from the Railway CLI config and never printed.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FIX = process.argv.includes('--fix');

// Values below are taken from deployment b07f760, the last deploy that DID come
// from GitHub, so they are known-good rather than guessed.
const PROJECT_ID = 'bddeb29a-a97a-4532-afad-fe8ad95b316e';
const ENVIRONMENT_ID = '5cf9e972-2b15-468e-99ed-d85b28588f90'; // production
const SERVICE_ID = '4b3420ce-cc9a-426a-9685-47866ad619c1';     // Mahathithi
const REPOSITORY = 'Ganesamurthi-V/Mahathithi';
const BRANCH = 'main';
const ROOT_DIRECTORY = '/backend';
// false on purpose: the repo has no GitHub Actions workflows, so waiting for a
// check suite that never reports would block every deploy indefinitely.
const CHECK_SUITES = false;

const cfgPath = join(homedir(), '.railway', 'config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

function findToken(o: unknown, path: string[] = []): string | null {
  if (typeof o === 'string' && o.length > 20 && /token/i.test(path.join('.'))) return o;
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const hit = findToken(v, [...path, k]);
      if (hit) return hit;
    }
  }
  return null;
}
const token = findToken(cfg);
if (!token) { console.error(`no credential in ${cfgPath} — run \`railway login\``); process.exit(1); }

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const r = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  const j: any = await r.json();
  if (j.errors) { console.error('GraphQL error:', JSON.stringify(j.errors).slice(0, 400)); return null; }
  return j.data;
}

async function listTriggers() {
  const d = await gql(
    `query ($id: String!) {
       project(id: $id) {
         services { edges { node {
           id name
           repoTriggers { edges { node { id branch repository provider checkSuites } } }
         } } }
       }
     }`,
    { id: PROJECT_ID }
  );
  return d?.project?.services?.edges ?? [];
}

async function main() {
  const services = await listTriggers();

  console.log('=== current state ===');
  let missing = false;
  for (const s of services) {
    const svc = s.node;
    const triggers = svc.repoTriggers?.edges ?? [];
    if (triggers.length === 0) {
      missing = true;
      console.log(`  ${svc.name}: NO repo trigger — pushes are ignored`);
    } else {
      for (const t of triggers) {
        const n = t.node;
        console.log(`  ${svc.name}: ${n.provider} ${n.repository}@${n.branch}  checkSuites=${n.checkSuites}`);
      }
    }
  }

  if (!missing) {
    console.log('\nA trigger exists. If pushes still do not deploy, the cause is upstream:');
    console.log('  - the Railway GitHub App no longer has access to the repo, or');
    console.log('  - the branch on the trigger does not match the branch being pushed.');
    return;
  }

  if (!FIX) {
    console.log('\nRe-run with --fix to create:');
    console.log(`  provider      github`);
    console.log(`  repository    ${REPOSITORY}`);
    console.log(`  branch        ${BRANCH}`);
    console.log(`  rootDirectory ${ROOT_DIRECTORY}`);
    console.log(`  checkSuites   ${CHECK_SUITES}`);
    return;
  }

  console.log('\ncreating repo trigger…');
  const res = await gql(
    `mutation ($input: DeploymentTriggerCreateInput!) {
       deploymentTriggerCreate(input: $input) { id branch repository provider checkSuites }
     }`,
    {
      input: {
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        serviceId: SERVICE_ID,
        provider: 'github',
        repository: REPOSITORY,
        branch: BRANCH,
        rootDirectory: ROOT_DIRECTORY,
        checkSuites: CHECK_SUITES,
      },
    }
  );

  if (!res?.deploymentTriggerCreate) { console.error('creation failed'); process.exit(1); }
  const t = res.deploymentTriggerCreate;
  console.log(`  created ${t.id}`);
  console.log(`  ${t.provider} ${t.repository}@${t.branch}  checkSuites=${t.checkSuites}`);

  console.log('\nverifying…');
  for (const s of await listTriggers()) {
    const svc = s.node;
    for (const e of svc.repoTriggers?.edges ?? []) {
      console.log(`  ${svc.name}: ${e.node.provider} ${e.node.repository}@${e.node.branch}`);
    }
  }
  console.log('\nNext push to main should now build. To undo: deploymentTriggerDelete(id).');
}
main().catch((e) => { console.error(String(e.message).slice(0, 300)); process.exit(1); });
