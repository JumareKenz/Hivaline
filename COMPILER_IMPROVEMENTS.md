# Compiler Improvements to Reach 95% Accuracy

**Current Status**: Runtime accuracy is **80% (16/20 PASS)** with the 2026.06.11.53 .hiv file.

**Gap to Target**: Need **+15%** improvement to reach 95% goal.

---

## Failing Test Cases (4/20)

1. **"ART for pregnant woman with HIV"** - Returns generic ART definition instead of pregnancy-specific protocols
   - Expected: PMTCT/pregnancy care guidelines
   - Actual: "Antiretroviral therapy, or ART, is the treatment of HIV infection..."
   
2. **"Signs of ART treatment failure"** - Returns wrong content (adherence tips or regimens instead of failure signs)
   - Expected: Virologic failure indicators, viral load thresholds
   - Actual: "Antiretroviral Regimens" or "Improving Adherence to ART"

3. **KMC queries (2 failures)** - No content exists for Kangaroo Mother Care
   - Cannot be fixed at runtime; source guidelines don't cover KMC

---

## Root Cause Analysis

### Problem 1: Single-Concept Variants
**Current**: Compiler generates variants for individual concepts:
- "HIV prevention in pregnancy" → pregnancy chunk
- "ART treatment guidelines" → ART chunk  
- "Antiretroviral therapy" → ART chunk

**Missing**: Multi-concept variants combining related topics:
- "ART for pregnant women" (combines ART + pregnancy)
- "HIV treatment during pregnancy" (combines HIV + pregnancy + treatment)
- "Antiretroviral therapy in pregnancy" (combines ART + pregnancy)

**Impact**: Query "ART for pregnant woman with HIV" matches "ART" weakly but misses pregnancy context.

---

### Problem 2: Word Order Sensitivity
**Current**: Variant "HIV treatment failure signs" exists but doesn't match query "Signs of ART treatment failure" strongly because:
- Word order differs ("signs" at end vs beginning)
- Synonym mismatch ("HIV" vs "ART")
- Keyword-based scoring penalizes reordering

**Missing**: Paraphrases with varied word orders:
- "Signs of HIV treatment failure"
- "Symptoms of ART failure"  
- "Treatment failure indicators"
- "ART failure symptoms"

**Impact**: Correct content exists but scores lower than generic definitions.

---

##  **COMPILER IMPROVEMENTS (General, Document-Agnostic)**

### **1. Multi-Concept Variant Generation** [HIGH PRIORITY]

**Goal**: Generate variants that combine 2-3 main concepts from each chunk.

**Algorithm**:
```python
def generate_multi_concept_variants(chunk):
    """
    For ANY document type - medical, legal, technical, etc.
    """
    # Step 1: Extract main concepts from chunk
    main_topics = extract_key_concepts(chunk)  
    # e.g., ["HIV", "pregnancy", "antiretroviral", "prevention", "PMTCT"]
    
    # Step 2: Generate cross-product combinations
    variants = []
    for concept_pair in combinations(main_topics, 2):
        variants.extend([
            f"{concept_pair[0]} {chunk.action_verb} in {concept_pair[1]}",
            f"{concept_pair[1]} {chunk.action_verb} for {concept_pair[0]}",
            f"Managing {concept_pair[0]} during {concept_pair[1]}",
            # etc - use templates that work for ANY domain
        ])
    
    for concept_triple in combinations(main_topics, 3):
        variants.extend([
            f"{concept_triple[0]} and {concept_triple[1]} in {concept_triple[2]}",
            # etc
        ])
    
    return variants

# Example outputs:
# Medical: "HIV treatment in pregnancy", "ART for pregnant women"
# Legal: "Contract termination during bankruptcy", "Bankruptcy clauses in contracts"
# Technical: "Engine maintenance during winter", "Cold weather engine care"
```

**Implementation Details**:
1. Extract 3-7 key concepts per chunk using:
   - Chunk title keywords
   - Section headings
   - High-frequency domain terms (TF-IDF)
   - Named entities (medical conditions, drugs, procedures)

2. Use domain-agnostic templates:
   - "{concept_A} in {concept_B}"
   - "{concept_A} for {concept_B} patients/users/cases"
   - "{concept_A} during {concept_B}"
   - "Managing {concept_A} with {concept_B}"
   - "{concept_A} and {concept_B} guidelines/procedures"

3. Filter generated variants:
   - Must be 3-8 words
   - Must not duplicate existing variants
   - Must be grammatically valid (use language model scoring)

**Expected Impact**: +10% accuracy (fixes "ART for pregnant woman" and similar multi-concept queries)

---

### **2. Paraphrase Expansion with Reordering** [MEDIUM PRIORITY]

**Goal**: Generate 3-5 paraphrases per variant with different word orders and synonyms.

**Algorithm**:
```python
def generate_paraphrases(variant_text):
    """
    Works for ANY domain - uses T5 or rule-based reordering
    """
    paraphrases = []
    
    # Method 1: Reorder using syntactic parsing
    parsed = parse_syntax(variant_text)
    paraphrases.extend([
        reorder_subject_verb(parsed),      # "treatment failure signs" -> "signs of treatment failure"
        move_modifiers(parsed),            # "HIV treatment signs" -> "signs of HIV treatment"
        swap_synonyms(parsed),             # "signs" -> "symptoms", "indicators"
    ])
    
    # Method 2: Use paraphrase model (T5-base or BART)
    paraphrases.extend(
        t5_model.generate(
            f"paraphrase: {variant_text}",
            num_return_sequences=3,
            temperature=0.7
        )
    )
    
    # Method 3: Template-based reordering
    if contains_pattern(variant_text, "{adjective} {noun}"):
        paraphrases.append(f"{noun} for/in/with {adjective}")
    
    return deduplicate(paraphrases)

# Example:
# Input: "HIV treatment failure signs"
# Output: [
#     "Signs of HIV treatment failure",
#     "Symptoms of ART failure",
#     "Treatment failure indicators",
#     "HIV failure symptoms",
#     "Indicators of treatment not working"
# ]
```

**Implementation Details**:
1. For each existing variant, generate 3-5 paraphrases
2. Use combination of:
   - **T5-base paraphrase model** (Hugging Face: `t5-base-paraphraser`)
   - **Syntactic reordering** (spaCy/stanza for dependency parsing)
   - **Synonym replacement** (WordNet or domain-specific thesaurus)

3. Quality filters:
   - Semantic similarity > 0.85 to original (using sentence-transformers)
   - No meaning drift (verify with entailment model)
   - Grammatically correct (LanguageTool or grammar model)

4. Deduplicate across all variants

**Expected Impact**: +5% accuracy (fixes word-order mismatches like "Signs of X failure")

---

### **3. Coverage Gap Detection** [LOW PRIORITY - Reporting Only]

**Goal**: After compilation, identify topics that users might ask about but have no content.

**Algorithm**:
```python
def detect_coverage_gaps(compiled_hiv):
    """
    Analyze compiled file and report missing topics
    """
    # Step 1: Extract all topics covered
    covered_topics = set()
    for chunk in compiled_hiv.chunks:
        covered_topics.update(extract_key_concepts(chunk))
    
    # Step 2: Load common query patterns (domain-agnostic)
    common_queries = load_common_queries_for_domain(document_type)
    # e.g., medical: ["what is X", "X dose", "X side effects", "when to use X"]
    # legal: ["X clause definition", "X requirements", "X penalties"]
    
    # Step 3: Extract topics from queries
    query_topics = set()
    for query in common_queries:
        query_topics.update(extract_entities(query))
    
    # Step 4: Find gaps
    gaps = query_topics - covered_topics
    
    # Step 5: Score by query frequency
    scored_gaps = []
    for topic in gaps:
        query_count = count_queries_about(topic, common_queries)
        scored_gaps.append({
            'topic': topic,
            'query_count': query_count,
            'example_queries': get_example_queries(topic, common_queries)[:3]
        })
    
    return sorted(scored_gaps, key=lambda x: x['query_count'], reverse=True)

# Example output:
# COVERAGE GAPS DETECTED:
# - Topic: "kangaroo mother care" (KMC)
#   Query count: 2
#   Examples: ["What is KMC?", "When to stop KMC?"]
#   Recommendation: Add source document on KMC or mark as out-of-scope
#
# - Topic: "diabetes"
#   Query count: 1
#   Examples: ["Diabetes management"]
#   Recommendation: Likely out of scope for HIV guidelines
```

**Implementation Details**:
1. Build a query corpus:
   - Extract common question patterns from web search logs
   - Generate synthetic queries using templates + entity substitution
   - For medical: use TREC Clinical Decision Support queries
   - For legal: use legal Q&A datasets
   - For technical: use product support forum queries

2. Entity extraction:
   - Use NER (spaCy, or domain-specific models)
   - Extract noun phrases
   - Domain-specific: drug names, procedures, legal terms, part numbers

3. Generate report in compiler output:
   ```json
   {
     "coverage_gaps": [
       {
         "topic": "kangaroo mother care",
         "query_count": 2,
         "severity": "medium",
         "recommendation": "add_content"
       }
     ]
   }
   ```

**Expected Impact**: 0% accuracy improvement (reporting only), but helps identify content gaps for future updates.

---

## Implementation Priority

1. **PHASE 1** (Target: 90% accuracy):
   - Implement multi-concept variant generation
   - Test on current .hiv file
   - Expected: 16/20 → 18/20 (fixes pregnant woman + ART query)

2. **PHASE 2** (Target: 95% accuracy):
   - Add paraphrase expansion
   - Test on updated .hiv file
   - Expected: 18/20 → 19/20 (fixes "Signs of failure" query)

3. **PHASE 3** (Future):
   - Coverage gap detection for reporting
   - No immediate accuracy impact

---

## Testing Protocol

After each phase, recompile guidelines and test with:

```bash
node test-runtime.mjs
```

**Success Criteria**:
- Phase 1: ≥ 18/20 (90%)
- Phase 2: ≥ 19/20 (95%)

**Test queries that MUST pass**:
1. "ART for pregnant woman with HIV" → pregnancy care chunk
2. "Signs of ART treatment failure" → failure indicators chunk
3. All current passing queries must remain passing (no regression)

---

## Notes

- **KMC failures** cannot be fixed by compiler - source guidelines don't cover KMC
- **All improvements are domain-agnostic** - work for medical, legal, technical, or any knowledge base
- **Runtime is already optimized** - further gains require better variant generation at compile time
- **Current .hiv file** (2026.06.11.53) has good structure, just needs better variant coverage
