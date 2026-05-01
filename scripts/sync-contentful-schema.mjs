#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

const ROOT = '/srv/cms'
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'src', 'api')
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'scripts', 'contentful-sync.config.json')

const outputDir = args.output || DEFAULT_OUTPUT_DIR
const schemaPath = args.schema || process.env.CONTENTFUL_SCHEMA_FILE
const cmaToken = args.token || process.env.CONTENTFUL_MANAGEMENT_TOKEN
const spaceId = args.space || process.env.CONTENTFUL_SPACE_ID || process.env.NEXT_PUBLIC_CONTENTFUL_SPACEID
const envId = args.environment || process.env.CONTENTFUL_ENVIRONMENT || 'master'
const apply = Boolean(args.apply)
const configPath = args.config || DEFAULT_CONFIG_PATH

const config = loadConfig(configPath)
const singleTypeSet = new Set([
  ...(config.singleTypes || []),
  ...splitCsv(args.singleTypes || ''),
].map((v) => String(v).trim()).filter(Boolean))
const relationOverrides = config.relationTargets || {}

main().catch((error) => {
  console.error('\nSchema sync failed:', error.message)
  process.exit(1)
})

async function main() {
  let contentTypes

  if (schemaPath) {
    contentTypes = readContentTypesFromFile(schemaPath)
    console.log(`Loaded ${contentTypes.length} content types from schema file: ${schemaPath}`)
  } else {
    if (!cmaToken || !spaceId) {
      throw new Error('Missing Contentful CMA credentials. Provide --schema or set CONTENTFUL_MANAGEMENT_TOKEN and CONTENTFUL_SPACE_ID.')
    }
    contentTypes = await fetchContentTypesFromCMA({ token: cmaToken, spaceId, envId })
    console.log(`Fetched ${contentTypes.length} content types from Contentful CMA (${spaceId}/${envId})`)
  }

  const idToUid = Object.fromEntries(contentTypes.map((ct) => [ct.sys.id, toUid(ct.sys.id)]))

  let written = 0
  let planned = 0
  const warnings = []

  for (const ct of contentTypes) {
    const uid = idToUid[ct.sys.id]
    const kind = singleTypeSet.has(ct.sys.id) || singleTypeSet.has(uid) ? 'singleType' : 'collectionType'
    const schema = toStrapiSchema({ ct, uid, kind, idToUid, relationOverrides, warnings })

    const targetPath = path.join(outputDir, uid, 'content-types', uid, 'schema.json')
    planned++

    if (apply) {
      ensureDir(path.dirname(targetPath))
      fs.writeFileSync(targetPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8')
      written++
      console.log(`Wrote: ${targetPath}`)
    } else {
      console.log(`Plan: ${targetPath}`)
    }
  }

  console.log('\nSummary:')
  console.log(`- Content types: ${contentTypes.length}`)
  console.log(`- Planned files: ${planned}`)
  console.log(`- Written files: ${written}`)

  if (warnings.length) {
    console.log(`- Warnings: ${warnings.length}`)
    for (const msg of warnings.slice(0, 40)) {
      console.log(`  - ${msg}`)
    }
    if (warnings.length > 40) {
      console.log(`  - ...and ${warnings.length - 40} more`)
    }
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write schema files.')
  } else {
    console.log('\nNext: restart Strapi to load schemas (pm2 restart tasfrl-cms --update-env).')
  }
}

function toStrapiSchema({ ct, uid, kind, idToUid, relationOverrides, warnings }) {
  const attributes = {}

  for (const field of ct.fields || []) {
    const mapped = mapField({ contentTypeId: ct.sys.id, field, idToUid, relationOverrides, warnings })
    if (!mapped) {
      warnings.push(`${ct.sys.id}.${field.id}: unsupported field type ${field.type}, mapped to json`)
      attributes[field.id] = { type: 'json' }
      continue
    }

    if (field.required) mapped.required = true

    const unique = (field.validations || []).some((rule) => rule.unique === true)
    if (unique) mapped.unique = true

    if (field.localized) {
      warnings.push(`${ct.sys.id}.${field.id}: localized field detected (requires i18n strategy)`)
    }

    attributes[field.id] = mapped
  }

  const base = {
    kind,
    info: {
      // Strapi requires content-type key to exactly match singularName.
      singularName: uid,
      pluralName: toPlural(uid),
      displayName: ct.name || toDisplayName(uid),
      description: ct.description || '',
    },
    options: {
      draftAndPublish: true,
    },
    pluginOptions: {},
    attributes,
  }

  if (kind === 'collectionType') {
    base.collectionName = toCollectionName(uid)
  }

  return base
}

function mapField({ contentTypeId, field, idToUid, relationOverrides, warnings }) {
  const type = field.type

  if (type === 'Symbol') return { type: 'string' }
  if (type === 'Text') return { type: 'text' }
  if (type === 'RichText') return { type: 'richtext' }
  if (type === 'Integer') return { type: 'integer' }
  if (type === 'Number') return { type: 'decimal' }
  if (type === 'Date') return { type: 'datetime' }
  if (type === 'Boolean') return { type: 'boolean' }
  if (type === 'Object' || type === 'Location') return { type: 'json' }

  if (type === 'Link') {
    if (field.linkType === 'Asset') {
      return {
        type: 'media',
        multiple: false,
        allowedTypes: ['images', 'files', 'videos', 'audios'],
      }
    }

    if (field.linkType === 'Entry') {
      const targetUid = resolveRelationTarget({ contentTypeId, field, idToUid, relationOverrides })
      if (!targetUid) {
        warnings.push(`${contentTypeId}.${field.id}: entry relation has no target; mapped to json`)
        return { type: 'json' }
      }

      return {
        type: 'relation',
        relation: 'oneToOne',
        target: `api::${targetUid}.${targetUid}`,
      }
    }
  }

  if (type === 'Array') {
    const item = field.items || {}

    if (item.type === 'Link' && item.linkType === 'Asset') {
      return {
        type: 'media',
        multiple: true,
        allowedTypes: ['images', 'files', 'videos', 'audios'],
      }
    }

    if (item.type === 'Link' && item.linkType === 'Entry') {
      const targetUid = resolveRelationTarget({ contentTypeId, field, idToUid, relationOverrides })
      if (!targetUid) {
        warnings.push(`${contentTypeId}.${field.id}: array relation has no target; mapped to json`)
        return { type: 'json' }
      }

      return {
        type: 'relation',
        relation: 'oneToMany',
        target: `api::${targetUid}.${targetUid}`,
      }
    }

    return { type: 'json' }
  }

  return null
}

function resolveRelationTarget({ contentTypeId, field, idToUid, relationOverrides }) {
  const overrideKey = `${contentTypeId}.${field.id}`
  const override = relationOverrides[overrideKey]
  if (override) return toUid(override)

  const validations = field.validations || []
  for (const rule of validations) {
    if (Array.isArray(rule.linkContentType) && rule.linkContentType.length === 1) {
      const targetContentTypeId = rule.linkContentType[0]
      return idToUid[targetContentTypeId] || toUid(targetContentTypeId)
    }
  }

  return null
}

function readContentTypesFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(raw)

  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.items)) return parsed.items
  if (Array.isArray(parsed.contentTypes)) return parsed.contentTypes

  throw new Error(`Schema file format not recognized: ${filePath}`)
}

async function fetchContentTypesFromCMA({ token, spaceId, envId }) {
  const limit = 100
  let skip = 0
  let total = 0
  const items = []

  do {
    const url = new URL(`https://api.contentful.com/spaces/${spaceId}/environments/${envId}/content_types`)
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('skip', String(skip))

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`CMA request failed (${res.status}): ${txt.slice(0, 500)}`)
    }

    const data = await res.json()
    total = data.total || 0

    for (const ct of data.items || []) items.push(ct)
    skip += limit
  } while (skip < total)

  return items
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    const next = argv[i + 1]

    if (key === '--apply') out.apply = true
    else if (key === '--help' || key === '-h') out.help = true
    else if (key === '--schema') out.schema = next, i++
    else if (key === '--space') out.space = next, i++
    else if (key === '--environment' || key === '--env') out.environment = next, i++
    else if (key === '--token') out.token = next, i++
    else if (key === '--output') out.output = next, i++
    else if (key === '--single-types') out.singleTypes = next, i++
    else if (key === '--config') out.config = next, i++
  }
  return out
}

function loadConfig(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (err) {
    throw new Error(`Invalid config JSON at ${filePath}: ${err.message}`)
  }
}

function splitCsv(input) {
  return String(input || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function toUid(value) {
  let uid = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Za-z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  if (!/^[a-z]/.test(uid)) {
    uid = `ct-${uid}`
  }

  return uid
}

function toDisplayName(uid) {
  return uid
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function toCollectionName(uid) {
  return toPlural(uid.replace(/-/g, '_'))
}

function toSingular(value) {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`
  if (value.endsWith('ses')) return value.slice(0, -2)
  if (value.endsWith('s') && !value.endsWith('ss')) return value.slice(0, -1)
  return value
}

function toPlural(value) {
  if (value.endsWith('s') || value.endsWith('x') || value.endsWith('z') || value.endsWith('ch') || value.endsWith('sh')) {
    return `${value}es`
  }
  if (value.endsWith('y') && !/[aeiou]y$/i.test(value)) {
    return `${value.slice(0, -1)}ies`
  }
  return `${value}s`
}

function printHelp() {
  console.log(`\nContentful -> Strapi schema sync\n\nUsage:\n  node scripts/sync-contentful-schema.mjs [options]\n\nOptions:\n  --apply                      Write schema files (default is dry-run)\n  --schema <file>              Use exported schema JSON instead of CMA API\n  --space <spaceId>            Contentful space id (or CONTENTFUL_SPACE_ID)\n  --env, --environment <id>    Contentful environment (default: master)\n  --token <token>              Contentful management token\n  --single-types <csv>         Mark content types as single types\n  --config <file>              Optional JSON config file\n  --output <dir>               Output base dir (default: /srv/cms/src/api)\n  -h, --help                   Show this help\n\nConfig file format (optional):\n{\n  \"singleTypes\": [\"metaDefault\", \"subscribeSettings\"],\n  \"relationTargets\": {\n    \"page.listOfSections\": \"sectionBlock\"\n  }\n}\n\nExamples:\n  CONTENTFUL_MANAGEMENT_TOKEN=... CONTENTFUL_SPACE_ID=... \\\n  node scripts/sync-contentful-schema.mjs --single-types metaDefault,subscribeSettings\n\n  node scripts/sync-contentful-schema.mjs --schema ./contentful-export/schema/content-types.json --apply\n`) 
}
