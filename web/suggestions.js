const item = (label, prompt) => ({ label, prompt });

const workflows = [
  {
    id: 'overview',
    keywords: ['summar', 'overview', 'metadata', 'cityobject', 'lod', 'attribute', 'crs', 'extent', 'bbox'],
    root: item('Summarize this dataset', 'Summarize the CityObjects, levels of detail, coordinate reference system, extent, and important attributes in this dataset.'),
    stages: [
      [
        item('Break down object types', 'Break down the CityObjects by type and explain what the distribution says about this dataset.'),
        item('Review levels of detail', 'Show which levels of detail are present, how frequently each occurs, and which object types use them.'),
        item('Inspect the CRS', 'Explain the coordinate reference system, coordinate extent, and whether the spatial metadata appears complete.'),
        item('Inventory attributes', 'List the available attributes, show which object types use them, and identify the most informative ones.'),
        item('Explain object hierarchy', 'Summarize parent-child relationships between Buildings, BuildingParts, and other CityObjects.'),
        item('Assess completeness', 'Identify missing or sparse metadata, attributes, geometry, or relationships that may limit use of this dataset.')
      ],
      [
        item('Find dominant classes', 'Which CityObject and geometry classes dominate this dataset, and which classes are unusual or rare?'),
        item('Compare LoDs by type', 'Compare levels of detail across CityObject types and call out inconsistent or mixed-LoD objects.'),
        item('Describe spatial coverage', 'Describe the real-world bounding box, width, depth, height range, and approximate spatial coverage.'),
        item('Find attribute gaps', 'For the important attributes, identify objects or object types where values are missing or inconsistent.'),
        item('Inspect appearances', 'Summarize whether textures, materials, semantic surfaces, or geometry templates are present and where they are used.'),
        item('List notable objects', 'Select a few representative or unusual CityObjects and explain why they stand out from the dataset summary.')
      ],
      [
        item('Create a technical report', 'Create a concise technical inventory of this dataset suitable for inclusion in project documentation.'),
        item('Prioritize data issues', 'Rank the most important metadata and consistency issues to address before using this dataset downstream.'),
        item('Recommend useful queries', 'Based on the dataset contents, propose six concrete CityJSON queries that would reveal useful details.'),
        item('Compare object families', 'Compare Buildings, BuildingParts, installations, vegetation, transportation, and other present object families.'),
        item('Explain interoperability', 'Explain how the version, CRS, LoDs, extensions, and appearances may affect interoperability with other software.'),
        item('Prepare a handoff summary', 'Write a short handoff summary covering content, quality caveats, and recommended next actions for another GIS specialist.')
      ]
    ]
  },
  {
    id: 'validation',
    keywords: ['valid', 'schema', 'geometry', 'error', 'issue', 'quality', 'repair', 'cjval', 'val3dity'],
    root: item('Validate the dataset', 'Run complete structural and geometric validation, then explain every important issue clearly.'),
    stages: [
      [
        item('Separate validation results', 'Separate schema and structural findings from geometric findings, with a clear validity result for each.'),
        item('Explain severe errors', 'Identify the highest-severity validation errors and explain their practical impact.'),
        item('Locate affected objects', 'List the CityObject IDs affected by validation errors and group them by error type.'),
        item('Inspect schema only', 'Run the official CityJSON schema validation and explain any syntax, schema, extension, or consistency errors.'),
        item('Inspect geometry only', 'Run verbose geometric validation and summarize invalid primitives and ISO 19107-related errors.'),
        item('Create a repair plan', 'Turn the validation results into a prioritized, step-by-step repair plan without modifying the dataset yet.')
      ],
      [
        item('Group repeated issues', 'Group repeated validation issues, count their occurrences, and show representative affected objects.'),
        item('Distinguish warnings', 'Distinguish definite invalidity from warnings, unavailable checks, and informational findings.'),
        item('Inspect an invalid object', 'Choose one representative invalid CityObject, inspect it in detail, and explain the likely source of its errors.'),
        item('Check metadata consistency', 'Check whether version, CRS, extensions, LoDs, and metadata are internally consistent with the object content.'),
        item('Estimate repair scope', 'Estimate how many objects and geometries require attention and which fixes could be automated safely.'),
        item('Find clean object groups', 'Identify object types or subsets that pass validation and could be used independently.')
      ],
      [
        item('Summarize for data owners', 'Write a concise validation report for the dataset owner, including validity, scope, impact, and next steps.'),
        item('Suggest safe cleanup', 'Recommend safe non-destructive cleanup operations that may improve consistency before revalidation.'),
        item('Define acceptance checks', 'Define a practical acceptance checklist for considering this CityJSON dataset production-ready.'),
        item('Compare validator findings', 'Compare what cjval and val3dity found and explain why their results may differ.'),
        item('Plan targeted subsets', 'Suggest targeted subsets that would make isolated validation and repair easier.'),
        item('Revalidate latest result', 'Validate the latest derived dataset again and compare its findings with the original dataset.')
      ]
    ]
  },
  {
    id: 'query',
    keywords: ['query', 'find', 'list', 'show', 'object', 'building', 'where', 'intersect', 'inside', 'largest'],
    root: item('Explore CityObjects', 'Show representative CityObjects with their IDs, types, levels of detail, and key attributes.'),
    stages: [
      [
        item('List Buildings', 'List the Buildings and BuildingParts with IDs, LoDs, and their most useful attributes.'),
        item('Find objects by type', 'Show the available CityObject types and ask me which type I want to query in detail.'),
        item('Find objects in an area', 'Explain the dataset bounding box and help me formulate a two-dimensional bounding-box query.'),
        item('Find objects by attribute', 'Identify useful attributes for filtering and show example attribute predicates supported by this dataset.'),
        item('Inspect one object', 'Choose a representative CityObject, retrieve it completely, and explain its geometry, attributes, and bounding box.'),
        item('Find parent-child links', 'List objects with parent-child relationships and explain the connected hierarchy.')
      ],
      [
        item('Find tallest candidates', 'Use available height attributes or geometry bounds to identify likely tallest Building objects.'),
        item('Find attribute outliers', 'Find unusual, extreme, or rare attribute values and list the associated object IDs.'),
        item('Compare selected objects', 'Select several representative objects of the dominant type and compare their attributes and LoDs.'),
        item('Find sparse objects', 'Find objects with unusually few attributes or missing geometry and list their IDs.'),
        item('Page through results', 'Show the next page of CityObjects using a compact list with IDs, types, attributes, and LoDs.'),
        item('Query mixed conditions', 'Construct a useful query combining object type, bounding box, and an attribute predicate based on this dataset.')
      ],
      [
        item('Create a query summary', 'Summarize the most useful findings from the object queries performed so far.'),
        item('Turn IDs into a subset', 'Create and download a subset containing the most relevant object IDs found in our queries.'),
        item('Investigate anomalies', 'Inspect the most anomalous queried objects individually and explain what makes them unusual.'),
        item('Map attribute coverage', 'Report attribute coverage by CityObject type using counts and percentages where possible.'),
        item('Check spatial clusters', 'Use bounding-box queries to identify whether objects appear concentrated in particular parts of the extent.'),
        item('Recommend next filters', 'Based on the query results, recommend six more precise filters worth running on this dataset.')
      ]
    ]
  },
  {
    id: 'subset',
    keywords: ['subset', 'extract', 'only', 'filter', 'selection', 'sample', 'exclude'],
    root: item('Create a Buildings subset', 'Create a subset containing only Buildings and BuildingParts, then give me the resulting CityJSON file to download.'),
    stages: [
      [
        item('Subset by object type', 'Show the available CityObject types, then create and download a subset for the type I choose.'),
        item('Subset by LoD', 'Show the available levels of detail, then keep one LoD in a derived dataset and make it downloadable.'),
        item('Subset by bounding box', 'Show the dataset extent and help me choose a bounding box for a downloadable spatial subset.'),
        item('Subset by IDs', 'List representative CityObject IDs, then create a downloadable subset from the IDs I select.'),
        item('Create a random sample', 'Create a small random sample of CityObjects suitable for testing and give me the file.'),
        item('Exclude an object type', 'Show the object-type counts and create a derived dataset excluding the type that contributes the most noise.')
      ],
      [
        item('Validate the subset', 'Run complete validation on the latest subset and compare it with the original dataset.'),
        item('Summarize the subset', 'Summarize the latest subset, including counts, LoDs, CRS, attributes, and spatial extent.'),
        item('Reduce the subset further', 'Suggest a useful way to reduce the latest subset further by type, area, IDs, or random sampling.'),
        item('Clean subset vertices', 'Remove duplicate and orphan vertices from the latest subset, then provide the cleaned file.'),
        item('Keep one LoD', 'Keep the most widely used LoD in the latest subset and give me the result to download.'),
        item('Compare file complexity', 'Compare object counts, vertex counts, object types, and LoDs between the original dataset and latest subset.')
      ],
      [
        item('Download latest subset', 'Prepare the latest derived subset and give me a direct CityJSON download.'),
        item('Export subset as OBJ', 'Export the latest subset to OBJ and provide the resulting files for download.'),
        item('Export subset as GLB', 'Export the latest subset to GLB and provide the resulting file for download.'),
        item('Document selection rules', 'Write a reproducible description of every selection and filtering step used to create the latest subset.'),
        item('Inspect retained objects', 'List the retained objects in the latest subset with their IDs, types, LoDs, and key attributes.'),
        item('Check subset portability', 'Assess whether the latest subset has enough metadata and valid geometry for transfer to another application.')
      ]
    ]
  },
  {
    id: 'transform',
    keywords: ['reproject', 'transform', 'clean', 'triangulate', 'translate', 'rename', 'remove', 'upgrade', 'merge', 'coordinate'],
    root: item('Review transformation options', 'Review this dataset and recommend useful, safe CityJSON transformations without changing it yet.'),
    stages: [
      [
        item('Clean vertices', 'Remove duplicate and orphan vertices, summarize the difference, and give me the cleaned CityJSON file.'),
        item('Reproject coordinates', 'Explain the current CRS and ask me for a target EPSG code before creating a reprojected downloadable dataset.'),
        item('Triangulate surfaces', 'Triangulate the dataset surfaces, validate the result, and provide the derived file.'),
        item('Translate coordinates', 'Explain how coordinate translation would affect this dataset and ask me for the intended minimum coordinates.'),
        item('Upgrade CityJSON', 'Check the CityJSON version and, if useful, upgrade it with cjio and give me the result.'),
        item('Review attributes', 'Identify attributes that might be safely renamed or removed and explain the consequences before changing them.')
      ],
      [
        item('Compare before and after', 'Compare the latest derived dataset with its source using counts, extent, CRS, LoDs, and validation status.'),
        item('Validate transformed data', 'Run complete schema and geometry validation on the latest transformed dataset.'),
        item('Remove textures', 'Report whether textures are present, then remove them from the latest dataset and provide the result if appropriate.'),
        item('Remove materials', 'Report whether materials are present, then remove them from the latest dataset and provide the result if appropriate.'),
        item('Rename an attribute', 'Show commonly used attributes and ask which one should be renamed before applying the change.'),
        item('Remove an attribute', 'Show low-value or sensitive attributes and ask which one should be removed before applying the change.')
      ],
      [
        item('Optimize for exchange', 'Recommend and apply a safe transformation sequence to make the latest dataset smaller and easier to exchange.'),
        item('Preserve a clean version', 'Prepare the latest successfully validated derived dataset as a CityJSON download.'),
        item('Explain transformation history', 'Summarize the transformations performed in this conversation and their effects on the dataset.'),
        item('Check coordinate precision', 'Assess coordinate precision and transform settings after the latest transformation.'),
        item('Compare geometry complexity', 'Compare vertex and geometry complexity before and after the transformations.'),
        item('Recommend final checks', 'Recommend the final checks to perform before accepting the transformed dataset.')
      ]
    ]
  },
  {
    id: 'delivery',
    keywords: ['download', 'export', 'convert', 'citygml', 'obj', 'stl', 'glb', 'b3dm', 'jsonl', 'deliver'],
    root: item('Review export options', 'Explain which CityJSON export and conversion formats are available and recommend the best options for this dataset.'),
    stages: [
      [
        item('Download CityJSON', 'Prepare the current dataset as a direct CityJSON download.'),
        item('Export to OBJ', 'Export the current dataset to OBJ and provide the resulting files for download.'),
        item('Export to GLB', 'Export the current dataset to GLB and provide the resulting file for download.'),
        item('Export to STL', 'Export the current dataset to STL and provide the resulting file for download.'),
        item('Export to CityJSONSeq', 'Export the current dataset as CityJSONSeq and provide the resulting file.'),
        item('Convert to CityGML', 'Convert the current dataset to CityGML and provide the resulting files for download.')
      ],
      [
        item('Validate before delivery', 'Validate the current dataset completely before preparing the final delivery files.'),
        item('Create a smaller delivery', 'Create a representative smaller subset and recommend an appropriate exchange format for it.'),
        item('Choose a web format', 'Compare GLB and b3dm for this dataset and recommend the more suitable web-delivery format.'),
        item('Choose a mesh format', 'Compare OBJ and STL for this dataset and recommend the more suitable mesh export.'),
        item('Check CRS for export', 'Verify whether the current CRS and metadata are appropriate for the requested export format.'),
        item('List delivery contents', 'List the files and metadata that should accompany this dataset in a professional delivery package.')
      ],
      [
        item('Prepare final CityJSON', 'Prepare and provide the latest approved CityJSON dataset for final download.'),
        item('Write a delivery note', 'Write a concise delivery note describing the dataset, CRS, version, LoDs, validation, and transformations.'),
        item('Document export settings', 'Document the exact format and transformation choices used for the latest export.'),
        item('Verify downloadable files', 'Confirm which downloadable files were produced in this conversation and what each contains.'),
        item('Recommend archive structure', 'Recommend a clear folder and filename structure for archiving the source, derived, and exported datasets.'),
        item('Create a handoff checklist', 'Create a final handoff checklist covering files, metadata, validation reports, CRS, and usage caveats.')
      ]
    ]
  }
];

const allItems = workflows.flatMap(workflow => [workflow.root, ...workflow.stages.flat()]
  .map(suggestion => ({ ...suggestion, topic: workflow.id })));

export const SUGGESTION_COUNT = allItems.length;

export function initialSuggestions() {
  return workflows.map(workflow => ({ ...workflow.root, topic: workflow.id, depth: 1 }));
}

export function followUpSuggestions(state) {
  const workflow = workflows.find(candidate => candidate.id === state?.topic);
  if (!workflow) return initialSuggestions();
  const depth = Number.isInteger(state?.depth) ? state.depth : 1;
  const stageIndex = Math.max(0, depth - 1) % workflow.stages.length;
  return workflow.stages[stageIndex].map(suggestion => ({
    ...suggestion,
    topic: workflow.id,
    depth: depth + 1
  }));
}

export function inferSuggestionState(text, currentState) {
  const normalized = String(text || '').trim().toLowerCase();
  const exact = allItems.find(candidate => candidate.prompt.toLowerCase() === normalized);
  if (exact) {
    const workflow = workflows.find(candidate => candidate.id === exact.topic);
    const stageIndex = workflow.stages.findIndex(stage => stage.includes(
      workflow.stages.flat().find(candidate => candidate.prompt === exact.prompt)
    ));
    return { topic: exact.topic, depth: stageIndex < 0 ? 1 : stageIndex + 2 };
  }
  const scored = workflows.map(workflow => ({
    topic: workflow.id,
    score: workflow.keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) {
    return {
      topic: scored[0].topic,
      depth: currentState?.topic === scored[0].topic ? (currentState.depth || 1) + 1 : 1
    };
  }
  return currentState?.topic ? { topic: currentState.topic, depth: (currentState.depth || 1) + 1 } : null;
}
