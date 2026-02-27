# Linear Workspace Reference: stream-kinetics

## Teams (Initiatives)

| Name | ID | Key | Type | Status |
|------|----|----|------|--------|
| contentguru.ai | `04d82360-6435-459f-af2e-efd5a3872444` | CG | Entity (Social Intelligence) | Active |
| metamirror.ai | `98058a1d-f74f-4241-927b-6a23d97dafda` | MM | Entity (Self Intelligence) | Active |
| wealthinnovation.ai | `51a336d3-c8bc-4eb6-acd4-15615b9c0adc` | WI | Entity (Personal Wealth) | Active |
| fungiagricap.com | `740c9bca-8056-483e-8355-d24f6a6596cd` | FAC | Entity (Physical/Real Estate) | Active |
| tabbytarot.fun | `1f5189fb-1da6-4e8d-a08f-1360a3ead0fd` | TAR | Entity (Spiritual Intelligence) | Active |
| hardshell | `a5586cd6-5118-410b-a710-8739bf6b2a2c` | HAR | Product (OpenClaw Hosting) | Active |
| stream-kinetics | `58bd7af3-e19a-406d-96c2-534bc496c74a` | SK | Workspace Admin | Active |

## Projects

### contentguru.ai (CG)
- **contentguru-seattle-unity** (ID: `0cded529-fba5-4c95-955f-49785d48a727`) - Seattle Unity Church digital platform

### metamirror.ai (MM)
- **metamirror-monique-neuropsych** (ID: TBD) - Dr. Monique Lowe neuropsychology platform

### hardshell (HAR)
- **hardshell-core** (ID: `ef04b933-feb1-4c78-8bb0-90dfc054d50b`) - Core product
- **hardshell-marketplace** (ID: `63b3de5a-d80e-49e2-903a-a2dc8784c740`) - Marketplace integration

### stream-kinetics (SK)
- **Standard Client Discovery Framework** - Parent issue SK-2 with discovery templates

## Key Issues

### Discovery Framework (SK)
| ID | Title | Type | Parent |
|----|-------|------|--------|
| SK-2 | Standard Client Discovery Intake Framework | Parent | N/A |
| SK-3 | Discovery Questionnaire Template | Child | SK-2 |
| SK-4 | Tech Stack Assessment Matrix | Child | SK-2 |
| SK-5 | Pain Points & Opportunities Canvas | Child | SK-2 |
| SK-6 | Data Model Definition | Child | SK-2 |
| SK-7 | Integration Architecture Checklist | Child | SK-2 |
| SK-8 | Client Onboarding Workflow | Child | SK-2 |

### Seattle Unity (CG-1)
| ID | Title | Type | Parent |
|----|-------|------|--------|
| CG-1 | Diane Presentation | Parent | N/A |
| CG-2 | Emotional Peak Frames | Child | CG-1 |
| CG-3 | Financial ROI Analysis | Child | CG-1 |
| CG-4 | 36-Week Timeline | Child | CG-1 |

### Dr. Monique Lowe (MM-8)
| ID | Title | Type | Parent |
|----|-------|------|--------|
| MM-8 | Dr. Monique Lowe — Neuropsychology Platform Engagement | Parent | N/A |
| MM-9 | Platform Security & Data Compliance | Child | MM-8 |
| MM-10 | Intake & Report Automation Architecture | Child | MM-8 |
| MM-11 | Practice Website Redesign | Child | MM-8 |
| MM-12 | Initial In-Person Meeting — Prep & Scope | Child | MM-8 |
| MM-13 | Scalability & Staff Delegation Model | Child | MM-8 |

## Initiatives (Strategic)

| ID | Name | Owner | Entities |
|----|------|-------|----------|
| `43ac7840-d6e9-455f-bbe9-02fc9809eb2a` | contentguru.ai | Joshua Fischburg | CG |
| `09aa18f7-5b8b-471c-836b-2287a7282ae1` | metamirror.ai | Joshua Fischburg | MM |
| `814a7578-c130-469b-9d68-0fb841fa89dc` | wealthinnovation.ai | Joshua Fischburg | WI |
| `1a006201-1a04-45ae-9e95-dcec666e42ec` | fungiagricap.com | Joshua Fischburg | FAC |
| `b375fba2-71bf-4df8-9c77-e7fd410f7bf9` | tabbytarot.fun | Joshua Fischburg | TAR |
| `c26b3c05-6901-44f4-8dd5-bf2ae0b087ff` | hardshell | Joshua Fischburg | HAR |

## Common Operations

### Get team by key
```
query { teams { nodes { id name key } } }
```

### Get all issues for team
```
query { issues(first: 50, filter: { team: { key: "SK" } }) { nodes { id identifier title } } }
```

### Create issue under parent
```
mutation {
  issueCreate(input: {
    teamId: "..."
    title: "..."
    parentId: "..."
  }) {
    issue { id identifier }
  }
}
```

### Update issue description
```
mutation {
  issueUpdate(id: "...", input: {
    description: "..."
  }) {
    issue { id }
  }
}
```
