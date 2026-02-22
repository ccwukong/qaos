---
name: csv-test-import
description: Import CSV test cases into PostgreSQL using an LLM-derived column mapping and a streaming transformation pipeline.
---

# CSV Test Import

Use this skill when a user wants to import test cases from CSV into qaos. CSV formats can be arbitrary, so first infer structure and mapping, then run the import script.

## Trigger Conditions

- User asks to import or migrate test cases from a `.csv` file.
- CSV has unknown or inconsistent schema.
- User wants structured PostgreSQL test records.

## Instructions

1. Inspect CSV headers and representative rows.
2. Infer a mapping from raw CSV columns to normalized keys.
3. Call the script with `run_script` using `transform-csv`.
4. Report import summary (`insertedCount`, `skippedCount`) and any skipped-row reasons.

## `run_script` template

```json
{
  "action": "run_script",
  "skill_name": "csv-test-import",
  "script": "transform-csv",
  "args": {
    "csvPath": "/absolute/path/to/file.csv",
    "testId": "import-2026-02-21",
    "mapping": {
      "Test case": "title",
      "Priority": "priority",
      "Description": "description",
      "Tested by": "testedBy",
      "Test result": "testResult",
      "Bug ticket": "bugTicket"
    },
    "batchSize": 500
  }
}
```

## Notes

- The script uses stream-based processing (`fs.createReadStream`) and does not load full CSV into memory.
- Use larger `batchSize` for faster imports on stable DB/network.
- If CSV does not have headers, first derive synthetic headers and adjust mapping accordingly.
