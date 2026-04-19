# WisdomWorks Platform — Cost & Revenue Projection

**Date:** 2026-03-26
**Status:** Draft for Review
**PRD Reference:** `_bmad-output/planning-artifacts/prd.md`
**Architecture Reference:** `_bmad-output/planning-artifacts/architecture.md`

---

## Executive Summary

WisdomWorks MVP infrastructure costs **$95-275/month** depending on AI model selection. The platform's revenue potential ranges from **$50K-250K per consulting engagement** at MVP to **$2-10M+ in government contracts** at scale. The architecture supports three deployment modes: cloud (SaaS), hybrid, and fully air-gapped — each with different cost profiles.

---

## 1. MVP Monthly Infrastructure Cost (13 Users)

### Cloud Deployment (Vercel + Azure)

| Service | Tier | Monthly Cost | Notes |
|---------|------|-------------|-------|
| **Vercel** (Next.js web) | Pro (1 seat) | $20-28 | Includes 1TB bandwidth, 1M invocations |
| **Azure Container Apps** (Python services + NATS) | Consumption | $35-70 | 2 containers (agent service + NATS JetStream) |
| **Azure PostgreSQL** | Burstable B1ms | $12-15 | 1 vCore, 2 GiB RAM, pgvector included |
| **Azure Container Registry** | Basic | $5 | Docker image storage |
| **Microsoft Entra ID** | Free | $0 | SSO + MFA included for 13 users |
| **GitHub Actions** (CI/CD) | Free tier | $0 | 2,000 min/month covers MVP build frequency |
| **Domain + SSL** | Let's Encrypt | $1.50 | ~$18/year domain |
| **AI/LLM API** | Variable | $3-140 | See Section 2 |
| | | | |
| **TOTAL (MVP)** | | **$76-260/month** | |

### Cost Optimization Notes — MVP

- **Vercel Hobby tier is free** but restricted to non-commercial use. Pro at $20/mo is the floor.
- **Azure Container Apps free tier** covers ~50 vCPU-hours/month — enough for light MVP usage during business hours. After-hours scaling to zero saves significantly.
- **PostgreSQL B1ms ($12/mo)** is sufficient for 13 users and 10K entities. Storage at $0.11/GB is negligible at MVP.
- **Entra ID free tier** covers everything needed — SSO, MFA, unlimited app registrations.
- **GitHub Actions** free tier (2,000 min/month) supports ~130 builds at 15 min each. MVP won't exceed this.

---

## 2. AI/LLM API Cost Analysis

### Pipeline Per Email (4-5 AI calls)

The email intelligence pipeline processes each email through: Classification → Confidence Scoring → Signal Extraction → Ontology Mapping → Embedding.

| Pipeline Strategy | Model Selection | Cost/Email | 100 emails/day | 1,000 emails/day |
|-------------------|----------------|------------|-----------------|-------------------|
| **Cost-Optimized** | GPT-4.1-nano + mini | $0.0001 | $0.30/mo | $3/mo |
| **Balanced** | Haiku classification + Sonnet extraction | $0.005 | $15/mo | $150/mo |
| **Premium** | Sonnet/Opus for everything | $0.026 | $78/mo | $780/mo |
| **Batch-Optimized** | Anthropic Batch API (50% off) | $0.012 | $36/mo | $360/mo |

### MVP Recommendation

At 13 users generating ~50-100 emails/day of business relevance:

- **Start with Cost-Optimized** (~$3/mo) using fast models for classification
- **Use Balanced for extraction/analysis** (~$15/mo) where quality matters
- **Blended MVP cost: ~$10-20/month** for AI

### Model Pricing Reference (per 1M tokens)

| Model | Input | Output | Best For |
|-------|-------|--------|----------|
| GPT-4.1-nano | $0.05 | $0.20 | Classification (fast, cheap) |
| GPT-4.1-mini | $0.10 | $0.40 | Signal extraction |
| Claude Haiku 4.5 | $1.00 | $5.00 | Classification + extraction |
| GPT-4o-mini | $0.15 | $0.60 | Balanced quality/cost |
| GPT-4o | $2.50 | $10.00 | Analysis/insights |
| Claude Sonnet 4.6 | $3.00 | $15.00 | Complex reasoning |
| Claude Opus 4.6 | $5.00 | $25.00 | Highest quality |
| text-embedding-3-small | $0.02 | — | Vector embeddings |

### Model Abstraction Layer Value

The architecture's model abstraction layer is critical here — it allows switching models per-task without code changes. Start cheap, upgrade individual pipeline stages as quality demands increase.

---

## 3. Growth Phase Cost Projection (500+ Users)

### Cloud Deployment at Scale

| Service | Tier | Monthly Cost | Notes |
|---------|------|-------------|-------|
| **Vercel** | Pro (3 seats) | $60-195 | Higher bandwidth, CPU, 3 developers |
| **Azure Container Apps** | Consumption (5-8 containers) | $400-750 | Agent services, NATS, workers |
| **Azure PostgreSQL** | General Purpose D2s_v3 | $70-100 | 2 vCores, 8 GiB, read replicas extra |
| **Azure Container Registry** | Standard | $10 | Multiple image repos |
| **Entra ID** | P1 ($6/user) | $3,000 | 500 users × $6 for Conditional Access |
| **GitHub Actions** | Paid minutes | $50-85 | ~15 CI runs/day, 15 min each |
| **AI/LLM API** | Balanced pipeline | $150-800 | 1,000 emails/hour throughput |
| **Monitoring/Logging** | Azure Monitor | $50-100 | Application Insights |
| | | | |
| **TOTAL (Growth)** | | **$3,800-5,000/month** | |

### Key Cost Drivers at Growth

1. **Entra ID P1 licensing** ($6/user) becomes the largest line item at 500+ users
2. **AI/LLM API costs** scale linearly with email volume — batch processing helps
3. **Container compute** scales with agent count and signal throughput
4. **PostgreSQL** may need General Purpose tier for concurrent query load

---

## 4. Government Deployment Cost (Azure-Only)

### Azure Government / IL5 / IL6

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| **Azure Government Container Apps** | $500-1,000 | 20-40% premium over commercial |
| **Azure Government PostgreSQL** | $100-200 | FIPS 140-2 validated encryption included |
| **Azure Government Kubernetes** | $1,000-3,000 | If required for IL5/IL6 isolation |
| **Entra ID P2** ($9/user) | Varies | Identity Protection + PIM required |
| **FedRAMP compliance overhead** | $5,000-15,000 | Initial assessment, ongoing audit |
| **CMMC certification** | $10,000-50,000 | One-time + annual renewal |
| | | |
| **TOTAL (Government)** | **$8,000-20,000/month** | Plus compliance costs |

### Air-Gapped Deployment (SCIF/Classified)

| Component | One-Time Cost | Monthly Cost | Notes |
|-----------|--------------|-------------|-------|
| **Server Hardware** (RTX 4090) | $2,500-7,000 | — | GPU for local LLM inference |
| **Enterprise Hardware** (A100) | $7,000-15,000 | — | For 30-50 concurrent users |
| **Local LLM** (Llama 3.3/Mistral) | $0 | $0 | Open-source, no API costs |
| **Local Embeddings** (BGE-M3) | $0 | $0 | Open-source |
| **PostgreSQL + pgvector** | $0 | $0 | Self-hosted, open-source |
| **NATS JetStream** | $0 | $0 | Self-hosted, open-source |
| **vLLM inference engine** | $0 | $0 | Open-source |
| **Power/cooling/facility** | — | $200-500 | Data center costs |
| | | | |
| **TOTAL (Air-Gapped)** | **$2,500-15,000 one-time** | **$200-500/month** | No API costs ever |

**Air-gapped advantage**: After initial hardware investment, ongoing costs are minimal — no per-token API charges, no cloud subscriptions. A single RTX 4090 server serves 13-20 concurrent users with 7-13B parameter models.

---

## 5. Revenue Projections

### Revenue Model 1: AI Consulting (MVP → Growth)

| Engagement Type | Revenue per Engagement | Timeline | Margin |
|----------------|----------------------|----------|--------|
| **Discovery + Assessment** | $15,000-50,000 | 2-4 weeks | 70-80% |
| **Platform Deployment** | $50,000-150,000 | 4-8 weeks | 60-70% |
| **Ongoing Support** | $5,000-15,000/month | Recurring | 80-90% |
| **Custom Agent Development** | $25,000-75,000 | 2-6 weeks | 65-75% |

**Year 1 Projection (Solo Dev + Platform):**

| Scenario | Engagements | Revenue | Infrastructure Cost | Net |
|----------|-------------|---------|-------------------|-----|
| Conservative | 2-3 clients | $100K-200K | $3K | $97K-197K |
| Moderate | 4-6 clients | $250K-500K | $5K | $245K-495K |
| Aggressive | 8-10 clients | $500K-1M | $10K | $490K-990K |

### Revenue Model 2: SaaS Licensing (Growth Phase)

| Tier | Price/Org/Month | Target Orgs | ARR |
|------|----------------|-------------|-----|
| **Starter** (5-20 users) | $500-1,000 | 20-50 | $120K-600K |
| **Professional** (20-100 users) | $2,000-5,000 | 10-30 | $240K-1.8M |
| **Enterprise** (100-500 users) | $10,000-25,000 | 5-10 | $600K-3M |
| | | | |
| **Total SaaS ARR** | | 35-90 orgs | **$960K-5.4M** |

### Revenue Model 3: Government Contracts (Scale Phase)

| Contract Type | Value | Duration | Probability |
|---------------|-------|----------|-------------|
| **SBIR Phase I** | $50K-275K | 6-12 months | Medium |
| **SBIR Phase II** | $500K-1.5M | 2 years | Medium |
| **Direct DoD Contract** | $2M-10M | 3-5 years | Lower (requires past performance) |
| **Intelligence Community** | $5M-25M | 3-5 years | Lower (requires clearances + past performance) |
| **State/Local Government** | $200K-2M | 1-3 years | Higher (less competition) |

**Government is the high-upside play**: Few competitors have organizational intelligence platforms designed for classified environments from day one. The FIPS 140-2, Entra ID, and Azure Government architecture decisions position WisdomWorks uniquely.

### Revenue Summary — 5-Year Projection

| Year | Revenue Model | Low Estimate | High Estimate |
|------|---------------|-------------|---------------|
| **Year 1** | Consulting | $100K | $500K |
| **Year 2** | Consulting + Early SaaS | $300K | $1.5M |
| **Year 3** | SaaS + First Gov Contract | $1M | $5M |
| **Year 4** | SaaS Growth + Gov Expansion | $3M | $12M |
| **Year 5** | Multi-channel | $5M | $25M+ |

---

## 5b. Self-Deploying Platform Unit Economics (Per Customer)

### How The Money Works

Every customer pays a **security deposit upfront** (applied to their first invoice) then a **monthly subscription**. Your costs per customer are infrastructure only — no labor after the AI deploys them.

**Costs are NOT fixed per tier — they scale with the customer's actual usage.** A hair stylist with 4 agents handling 20 appointments/day costs less than a busy salon chain with 4 agents handling 200 appointments/day. The subscription price is determined during onboarding based on the customer's AxisDeploymentSpec: agent count, expected signal volume, communication channels, voice minutes, and integration complexity.

### What Drives Cost Per Customer

| Cost Driver | What Determines It | Low Usage | High Usage |
|------------|-------------------|-----------|------------|
| **LLM API calls** | Agent count × tasks/day × complexity | $0.50/mo (personal, 20 calls/day) | $500/mo (enterprise, 5K+ calls/day) |
| **Voice minutes** | Inbound call volume | $0 (no voice) | $50+/mo (busy appointment business) |
| **SMS/WhatsApp** | Notifications, reminders, client comms | $0 (no mobile) | $20+/mo (heavy booking confirmations) |
| **Storage** | Client profiles, photos, documents | $0 (minimal) | $5+/mo (visual intelligence, photo history) |
| **Compute share** | Agent runtime, signal processing | $0.25/mo (shared) | $100+/mo (dedicated containers) |

**Key insight:** Two businesses on the same tier can have very different costs. A plumber with voice AI answering 50 calls/day costs more than a freelance writer with just a personal assistant agent. The onboarding AI calculates the subscription price based on their ACTUAL expected usage, not just their tier.

### Representative Cost Examples

| Customer Example | Agents | Channels | Key Usage | Est. Cost | Subscription | Margin |
|-----------------|--------|----------|-----------|-----------|-------------|--------|
| Freelance writer (Personal) | 2 | WhatsApp only | Light task mgmt, 20 LLM calls/day | $1/mo | $10/mo | 90% |
| Solo barber (Solo) | 4 | WhatsApp + Voice | 15 appointments/day, 10 calls, SMS reminders | $18/mo | $75/mo | 76% |
| Busy electrician (Solo) | 4 | Voice + WhatsApp + Calendar | 30 calls/day, photo uploads, job tracking | $35/mo | $100/mo | 65% |
| Restaurant (Small Team) | 8 | Voice + WhatsApp + Website | 100 reservations/day, review monitoring, promos | $45/mo | $250/mo | 82% |
| Real estate office 10 ppl (Small Team) | 12 | All channels | Lead tracking, 500 emails/day, showings | $60/mo | $400/mo | 85% |
| Consulting firm 50 ppl (Mid-Size) | 50 | Dashboard + Desktop + Email | 1,500 emails/day, full ontology, globe | $150/mo | $3,000/mo | 95% |
| Defense contractor 500 ppl (Enterprise) | 200+ | All + classified | 5,000+ signals/day, compliance, dedicated infra | $800/mo | $15,000/mo | 95% |

### Security Deposit Schedule

| Tier | Deposit | Min Trial | Deposit Applied To |
|------|---------|-----------|-------------------|
| Personal | $10 | 30 days | First invoice |
| Solo | $50 | 30 days | First invoice |
| Small Team | $200 | 30 days | First invoice |
| Mid-Size | $500 | 60 days | First invoice |
| Enterprise | $2,000+ | 60 days | First invoice |

### Why The Deposit Matters

- LLM costs are **real from minute one** — every agent call costs money
- The deposit covers your costs for the first month before the first subscription payment
- Filters out tire-kickers who would cost you money without paying
- $50 deposit for a solo operator covers ~2 months of your actual costs to serve them
- The deposit IS prepayment — it applies to their first invoice, not a fee

### Volume Economics (Self-Deploying Platform)

| Customers | Mix | Monthly Revenue | Monthly Cost | Monthly Profit |
|-----------|-----|----------------|-------------|---------------|
| **50 customers** | 30 Solo + 15 Small + 5 Mid | $7,250 | $1,100 | $6,150 |
| **200 customers** | 100 Solo + 60 Small + 30 Mid + 10 Ent | $49,500 | $7,500 | $42,000 |
| **1,000 customers** | 500 Solo + 300 Small + 150 Mid + 50 Ent | $272,500 | $42,000 | $230,500 |
| **10,000 customers** | Broad mix | ~$1.5M/mo | ~$250K/mo | ~$1.25M/mo |

### Platform Infrastructure Cost (Your Fixed Costs)

These are YOUR costs to run the shared platform — independent of customer count:

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| Supabase Pro | $25 | Shared database for all standard-tier customers |
| Vercel Pro | $20-60 | Frontend hosting (scales with traffic) |
| Railway/Fly.io | $20-50 | Python agent services + NATS |
| Domain + SSL | $1.50 | wisdomworks.com |
| **TOTAL FIXED** | **$67-137/mo** | Covers platform for first ~100 customers |

At 100 customers averaging $75/mo = $7,500 revenue against ~$137 fixed + ~$1,500 variable = **$5,863 profit/month on $137 of fixed costs.** That's a **78% margin**.

### The Compounding Effect

Every new customer:
1. Pays a deposit (covers your cost to serve them for 1-2 months)
2. Pays monthly (60-90% margin)
3. Makes the dictionary smarter (anonymized learnings)
4. Makes onboarding faster for the NEXT customer of that type
5. Zero marginal labor — AI does everything

This is pure software margins after the platform is built.

---

## 6. Break-Even Analysis

### MVP Break-Even

| Monthly Cost | Break-Even Revenue | Path |
|-------------|-------------------|------|
| $95-275/mo infrastructure | 1 consulting engagement | Single $50K+ engagement covers 12+ months of infrastructure |

**WisdomWorks breaks even on a single consulting engagement.** Infrastructure costs are negligible compared to revenue potential. The real cost is development time.

### Development Time Investment

| Phase | Duration | Opportunity Cost (at $150/hr consulting rate) |
|-------|----------|----------------------------------------------|
| MVP (Sprint 0-4) | ~90 days | $180K (full-time) |
| Growth features | ~6 months additional | $360K |
| Government compliance | ~3-6 months | $180K-360K |

**Total development opportunity cost: $180K-900K** — recovered with 2-4 consulting engagements.

---

## 7. Cost Optimization Recommendations

### Immediate (MVP)

1. **Use Vercel Pro ($20/mo)** — don't over-provision
2. **Start with PostgreSQL B1ms ($12/mo)** — upgrade only when queries slow down
3. **Use Azure Container Apps consumption plan** — scales to zero when idle
4. **Entra ID free tier** — covers 13 users completely
5. **Cost-optimized AI pipeline** — nano/mini models for classification, balanced for extraction
6. **GitHub Actions free tier** — 2,000 min/month is plenty for MVP

### Growth

1. **Negotiate Azure Enterprise Agreement** — volume discounts on compute
2. **Use Anthropic/OpenAI Batch API** — 50% savings on non-real-time processing
3. **PostgreSQL reserved instances** — up to 60% savings with 1-year commitment
4. **Cache aggressively** — NATS KV reduces redundant AI calls
5. **Right-size containers** — monitor and adjust CPU/memory allocations monthly

### Government

1. **Azure Government pricing is 20-40% premium** — build this into contract pricing
2. **Air-gapped deployments eliminate API costs** — open-source LLMs on local hardware
3. **FedRAMP compliance is a moat** — expensive to achieve but creates competitive barrier
4. **Hardware one-time cost vs. ongoing cloud** — $2,500-15K hardware vs. $8K-20K/month cloud

---

## 8. Air-Gapped Deployment Architecture (New)

### What Makes It Possible

The WisdomWorks architecture already supports air-gapped deployment through:

1. **Model Abstraction Layer** — swap cloud APIs for local LLM inference (vLLM/Ollama)
2. **PostgreSQL + pgvector** — runs self-hosted, no cloud dependency
3. **NATS JetStream** — self-hosted event backbone
4. **Tauri v2 desktop app** — native client, no browser required
5. **Open-source alternatives** exist for every cloud service

### Local LLM Stack

| Component | Cloud Version | Air-Gapped Replacement |
|-----------|---------------|----------------------|
| OpenAI/Claude API | Cloud API calls | vLLM + Llama 3.3 70B or Mistral 7B |
| text-embedding-3-small | Cloud API | EmbeddingGemma or BGE-M3 (local) |
| Azure PostgreSQL | Managed service | Self-hosted PostgreSQL + pgvector |
| NATS (Azure Container Apps) | Managed container | Self-hosted NATS on bare metal |
| Vercel (Next.js) | Managed hosting | Self-hosted Node.js server |
| Entra ID | Cloud identity | Local identity provider (Keycloak) |

### Hardware Requirements

| Scale | GPU | RAM | Storage | Users | One-Time Cost |
|-------|-----|-----|---------|-------|---------------|
| **Small** (MVP) | RTX 4090 (24GB) | 32GB | 512GB NVMe | 13-20 | $2,500 |
| **Medium** | 2× RTX 4090 | 64GB | 1TB NVMe | 30-50 | $5,000 |
| **Large** | A100 (80GB) | 128GB | 2TB NVMe | 50-100 | $10,000-15,000 |
| **Enterprise** | 2× A100 or H100 | 256GB | 4TB NVMe | 100-500 | $30,000-50,000 |

### Quality Trade-off

Local 7-13B models are **1-2 capability generations behind** frontier models (GPT-4o, Claude Opus). For classified environments, this trade-off is acceptable because:
- Data sovereignty outweighs model capability
- Signal extraction and classification work well with smaller models
- No per-token costs at any volume
- Models improve rapidly — today's 13B approaches last year's 70B quality

---

## Appendix: Pricing Sources

- Vercel: vercel.com/pricing (Pro $20/user/mo)
- Azure Container Apps: azure.microsoft.com/pricing/details/container-apps/
- Azure PostgreSQL Flexible Server: azure.microsoft.com/pricing/details/postgresql/flexible-server/
- Microsoft Entra ID: microsoft.com/security/business/microsoft-entra-pricing
- OpenAI API: openai.com/api/pricing/
- Anthropic Claude: platform.claude.com/docs/en/about-claude/pricing
- GitHub Actions: docs.github.com/billing/managing-billing-for-github-actions/
- GPU pricing: gpucost.org/gpu-prices
- Azure Government: azure.microsoft.com/explore/global-infrastructure/government/

---

**End of Cost & Revenue Projection**
