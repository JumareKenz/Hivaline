#!/usr/bin/env python3
"""
HIVA MediChat Synthetic Dataset Generator
Healthcare Conversational AI Training Data for Nigerian CHW Workflows
"""

import random
import pandas as pd
from typing import List, Dict, Tuple
import re

class HIVADatasetGenerator:
    """Generate realistic Nigerian CHW-MediChat conversational pairs"""

    def __init__(self):
        self.generated_queries = set()
        self.conversation_id = 1

        # Define realistic query templates and variations
        self.templates = self._initialize_templates()
        self.typo_mappings = self._initialize_typo_mappings()
        self.pidgin_words = self._initialize_pidgin_vocabulary()

    def _initialize_typo_mappings(self) -> Dict[str, List[str]]:
        """Common medical term misspellings"""
        return {
            'diarrhea': ['diaroea', 'diarhoea', 'diarhea', 'diarrhea'],
            'pneumonia': ['pnemonia', 'pneumoniya', 'newmonia', 'pneumonia'],
            'malaria': ['malarya', 'mallaria', 'maleria', 'malaria'],
            'amoxicillin': ['amoxcilin', 'amoxicilin', 'amoxycilin', 'amoxicillin'],
            'immunization': ['imunization', 'immunisation', 'imunisation', 'immunization'],
            'convulsion': ['convultion', 'convulshon', 'convulsion'],
            'paracetamol': ['paracetamol', 'paracetmol', 'paracetamol'],
            'prescription': ['prescripshon', 'prescription', 'prescrption'],
            'temperature': ['temperture', 'tempreture', 'temperature'],
            'dosage': ['dosage', 'dosege', 'dosag'],
            'symptoms': ['symptom', 'symtoms', 'symptoms'],
            'breathing': ['brething', 'breathing', 'breathin'],
            'treatment': ['treatmen', 'treatment', 'tretment'],
            'injection': ['injecion', 'injekshon', 'injection'],
            'pregnant': ['pregnent', 'pregnat', 'pregnant'],
            'severe': ['seveer', 'sevre', 'severe'],
            'emergency': ['emergancy', 'emergency', 'emergenci'],
            'referral': ['referal', 'referral', 'refferal']
        }

    def _initialize_pidgin_vocabulary(self) -> Dict[str, List[str]]:
        """Nigerian Pidgin healthcare vocabulary"""
        return {
            'child': ['pikin', 'child', 'small pikin', 'chile'],
            'baby': ['baby', 'small baby', 'newborn'],
            'fever': ['feva', 'hot body', 'fever', 'high temperature'],
            'vomiting': ['dey vomit', 'throwing up', 'vomit', 'dey purge'],
            'diarrhea': ['dey stool', 'stooling', 'running belle', 'loose stool'],
            'weak': ['weak body', 'no get strength', 'weak', 'tire'],
            'not eating': ['no dey chop', 'no gree chop', 'refuse food', 'not eating'],
            'breathing problem': ['no dey breathe well', 'breathing problem', 'chest problem'],
            'what': ['wetin', 'what', 'watin'],
            'give': ['give', 'fit give', 'make I give'],
            'problem': ['problem', 'wahala', 'issue'],
            'sick': ['sick', 'don dey sick', 'ill']
        }

    def _initialize_templates(self) -> Dict[str, List[Dict]]:
        """Comprehensive template library for realistic conversations"""
        return {
            'malaria': [
                {
                    'query_template': '{child} with {fever} and {vomiting}, {what} to do',
                    'response': 'Check for danger signs: can the child drink? Any convulsions? If yes, refer urgently. For uncomplicated malaria: Give ACT (Artemether-Lumefantrine) based on weight. 5-14kg: 1 tablet twice daily for 3 days. Monitor for danger signs and advise to return if worsening.',
                    'category': 'Malaria',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                },
                {
                    'query_template': 'ACT dose for {weight}kg patient',
                    'response': 'ACT dosing: 5-14kg: 1 tablet BD x3 days; 15-24kg: 2 tablets BD x3 days; 25-34kg: 3 tablets BD x3 days; ≥35kg: 4 tablets BD x3 days. Take with food/milk.',
                    'category': 'Malaria',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': '{child} convulsing with {fever}',
                    'response': 'URGENT REFERRAL NEEDED. This is severe malaria. Give rectal artesunate if available (10mg/kg), position child safely, ensure airway clear, give nothing by mouth. Transfer immediately to health facility with injectable antimalarials.',
                    'category': 'Severe Malaria',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'rapid test positive, patient cannot drink',
                    'response': 'DANGER SIGN - REFER URGENTLY. Inability to drink/breastfeed indicates severe malaria. Give pre-referral rectal artesunate if trained (10mg/kg for children, 200mg for adults). Do not delay transfer.',
                    'category': 'Severe Malaria',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': '{fever} 3 days, RDT negative, {what} next',
                    'response': 'Negative RDT rules out malaria. Check for: pneumonia (fast breathing, chest indrawing), typhoid (persistent fever), UTI. Give paracetamol 15mg/kg for fever. If fever persists >3 days or worsens, refer for further investigation.',
                    'category': 'Fever Management',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                }
            ],

            'diarrhea': [
                {
                    'query_template': '{child} {diarrhea} 2 days, how to use ORS',
                    'response': 'Give ORS after each loose stool: <2yrs: 50-100ml; 2-10yrs: 100-200ml; >10yrs: 200-400ml. Add zinc: <6months: 10mg daily x10 days; ≥6months: 20mg daily x10 days. Continue breastfeeding. Watch for danger signs: no urine >6hrs, very weak, sunken eyes.',
                    'category': 'Diarrhea',
                    'severity': 'Moderate',
                    'referral': 'No'
                },
                {
                    'query_template': 'severe dehydration signs',
                    'response': 'Danger signs requiring URGENT referral: sunken eyes, skin pinch goes back slowly (>2 sec), very weak/unconscious, unable to drink, no urine >6 hours. These children need IV fluids immediately. Do not delay transfer.',
                    'category': 'Severe Dehydration',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'ORS and zinc dose for 8kg baby',
                    'response': 'For 8kg baby: ORS 50-100ml after each watery stool. Zinc 10mg daily for 10 days (baby <6 months gets 10mg, ≥6 months gets 20mg). Continue breastfeeding. Return if no improvement in 2 days or any danger signs appear.',
                    'category': 'Diarrhea',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': '{baby} {diarrhea} with blood',
                    'response': 'REFER URGENTLY. Bloody diarrhea (dysentery) requires antibiotics and investigation. Could be shigella or other serious infection. Give ORS during transfer, continue breastfeeding. Do not give antidiarrheals.',
                    'category': 'Dysentery',
                    'severity': 'High',
                    'referral': 'Yes'
                }
            ],

            'pneumonia': [
                {
                    'query_template': '{child} fast breathing and cough',
                    'response': 'Count respiratory rate for full minute: <2mo: ≥60 is fast; 2-11mo: ≥50 is fast; 1-5yr: ≥40 is fast. If fast breathing + cough: give amoxicillin 40mg/kg/day divided twice daily x5 days. Check for danger signs (chest indrawing, unable to drink, convulsions) - if present, refer urgently.',
                    'category': 'Pneumonia',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                },
                {
                    'query_template': 'chest indrawing with cough',
                    'response': 'SEVERE PNEUMONIA - REFER URGENTLY. Chest indrawing indicates respiratory distress requiring injectable antibiotics and oxygen. Give first dose IM benzylpenicillin if trained, then transfer immediately. Keep child warm, position upright.',
                    'category': 'Severe Pneumonia',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': '{amoxicillin} dose for 12kg {child}',
                    'response': 'Amoxicillin 40mg/kg/day: 12kg = 480mg daily = 240mg twice daily. Use 250mg/5ml suspension: give 5ml twice daily for 5 days. Must complete full course even if improving.',
                    'category': 'Pneumonia',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'baby grunting and not feeding',
                    'response': 'DANGER SIGNS - REFER IMMEDIATELY. Grunting respiration + unable to feed indicates severe respiratory distress in young infant. This is a medical emergency. Keep airway clear, keep warm, transfer urgently to facility with neonatal care.',
                    'category': 'Neonatal Emergency',
                    'severity': 'Critical',
                    'referral': 'Yes'
                }
            ],

            'maternal': [
                {
                    'query_template': '{pregnant} woman {bleeding} in 3rd trimester',
                    'response': 'OBSTETRIC EMERGENCY - REFER IMMEDIATELY. Antepartum hemorrhage is life-threatening. Lay woman flat, monitor vital signs, do NOT do vaginal exam. Transfer urgently to facility with caesarean section capability. This requires emergency obstetric care.',
                    'category': 'Maternal Emergency',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'ANC visit schedule',
                    'response': 'WHO recommends minimum 8 ANC contacts: 1st visit by 12 weeks, then at 20, 26, 30, 34, 36, 38, 40 weeks. Each visit: check BP, urine protein, fundal height, fetal heartbeat, give iron/folate, tetanus toxoid, ITN, deworming, HIV/syphilis screening.',
                    'category': 'Antenatal Care',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'pregnant woman with severe headache and blurred vision',
                    'response': 'DANGER SIGNS - REFER URGENTLY. Severe headache + visual disturbances suggest preeclampsia/eclampsia. Check BP if possible. Give MgSO4 if trained and BP ≥160/110. This is obstetric emergency requiring immediate hospital care.',
                    'category': 'Maternal Emergency',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'postpartum bleeding too much',
                    'response': 'EMERGENCY - ACT FAST. If bleeding soaks >2 pads in 30min: massage uterus firmly, give oxytocin 10IU IM if available, empty bladder, REFER URGENTLY. Postpartum hemorrhage is leading cause of maternal death. Do not delay transfer.',
                    'category': 'Postpartum Emergency',
                    'severity': 'Critical',
                    'referral': 'Yes'
                }
            ],

            'neonatal': [
                {
                    'query_template': 'newborn not crying after birth',
                    'response': 'Start resuscitation immediately: dry baby, stimulate by rubbing back, clear airway gently. If no breathing after 30 sec, begin bag-mask ventilation 40 breaths/min. REFER URGENTLY while resuscitating. Keep baby warm (skin-to-skin).',
                    'category': 'Neonatal Emergency',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'baby umbilical cord red and swollen',
                    'response': 'Likely umbilical cord infection (omphalitis). Clean with chlorhexidine/alcohol. If redness extends beyond umbilicus, pus present, or baby has fever/feeding problem - REFER URGENTLY for IV antibiotics. This can cause neonatal sepsis.',
                    'category': 'Neonatal Infection',
                    'severity': 'High',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'when to start breastfeeding',
                    'response': 'Initiate breastfeeding within 1 hour of birth. First milk (colostrum) is vital for immunity. Exclusive breastfeeding for 6 months - no water, no other foods. Feed on demand, 8-12 times per 24 hours. Ensure proper latch: baby takes areola, not just nipple.',
                    'category': 'Breastfeeding',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'baby yellow color day 2',
                    'response': 'Neonatal jaundice. Check: appearing after 24hrs? (Good - physiologic). Yellow palms/soles? Very drowsy? Not feeding well? If any concerns or jaundice before 24hrs/after 14 days, REFER for bilirubin check. Ensure frequent breastfeeding, monitor closely.',
                    'category': 'Neonatal Jaundice',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                }
            ],

            'immunization': [
                {
                    'query_template': '{immunization} schedule for baby',
                    'response': 'Birth: BCG, OPV0, HepB. 6wks: OPV1, Penta1, PCV1, Rota1. 10wks: OPV2, Penta2, PCV2, Rota2. 14wks: OPV3, Penta3, PCV3, IPV. 9mo: Measles1, YFV. 15mo: Measles2. Record all vaccines in child health card.',
                    'category': 'Immunization',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'baby missed vaccines at 10 weeks, now 6 months',
                    'response': 'Continue schedule from where stopped - DO NOT restart. Give missed doses now, then continue catch-up: give all missed vaccines at current visit (can give multiple vaccines same day different sites). Minimum 4 weeks between doses of same vaccine.',
                    'category': 'Immunization',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'adverse reaction after vaccine',
                    'response': 'Mild reactions (fever, injection site pain) are normal - give paracetamol 15mg/kg. REFER URGENTLY if: high fever >39°C, convulsions, difficulty breathing, severe swelling, anaphylaxis (within 1hr of injection). Report all serious reactions to immunization program.',
                    'category': 'Immunization',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                }
            ],

            'nutrition': [
                {
                    'query_template': 'child MUAC red band',
                    'response': 'MUAC <11.5cm (red) = Severe Acute Malnutrition. Check for bilateral pitting edema. If no complications: enroll in CMAM program, give RUTF (ready-to-use therapeutic food). If complications (medical issues, poor appetite, edema), REFER to stabilization center.',
                    'category': 'Severe Malnutrition',
                    'severity': 'High',
                    'referral': 'Conditional'
                },
                {
                    'query_template': 'complementary feeding advice',
                    'response': 'Start at 6 months (continue breastfeeding to 2yrs+). Begin with thick porridge, mashed foods. By 8mo: family foods, chopped. Feed 2-3 times daily at 6-8mo, 3-4 times at 9-24mo, plus nutritious snacks. Include: grains, legumes, dairy, eggs, meat/fish, fruits, vegetables. Enrich with oil/groundnut paste.',
                    'category': 'Nutrition',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': '{child} very thin with swollen legs',
                    'response': 'Bilateral pitting edema + wasting = Severe Acute Malnutrition (Kwashiorkor). REFER URGENTLY to therapeutic feeding program. High risk of death. Do not give high protein diet immediately - needs specialized medical nutrition. Check for infections.',
                    'category': 'Severe Malnutrition',
                    'severity': 'Critical',
                    'referral': 'Yes'
                }
            ],

            'hiv_tb': [
                {
                    'query_template': 'exposed infant HIV testing schedule',
                    'response': 'HIV-exposed infant testing: DNA PCR at 6 weeks (or earliest after birth), repeat at 9 months if 1st negative, then antibody test at 18 months. If positive at any point, start ART immediately. Ensure maternal ART adherence, exclusive breastfeeding with continued ARVs.',
                    'category': 'HIV/TB',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                },
                {
                    'query_template': 'patient coughing more than 2 weeks',
                    'response': 'TB screening indicated: cough >2 weeks + any of: fever, night sweats, weight loss. REFER for sputum testing (GeneXpert if available). Check HIV status. If TB confirmed, ensure DOT (directly observed therapy), check contacts for TB screening.',
                    'category': 'HIV/TB',
                    'severity': 'Moderate',
                    'referral': 'Yes'
                },
                {
                    'query_template': 'ART side effects',
                    'response': 'Common ART side effects: nausea (take with food), headache, dizziness (usually improve after 2-4 weeks). REFER if: severe rash, yellowing eyes/skin, severe abdominal pain, persistent vomiting, numbness/tingling. Never stop ART without medical advice - resistance risk.',
                    'category': 'HIV/TB',
                    'severity': 'Moderate',
                    'referral': 'Conditional'
                }
            ],

            'general_triage': [
                {
                    'query_template': 'emergency signs in children',
                    'response': 'EMERGENCY SIGNS requiring immediate referral: not able to drink/breastfeed, vomits everything, convulsions, lethargic/unconscious, chest indrawing, stridor when calm, severe malnutrition with complications. Also: severe dehydration, severe bleeding, severe burns. Do not delay.',
                    'category': 'General Triage',
                    'severity': 'Critical',
                    'referral': 'Yes'
                },
                {
                    'query_template': '{paracetamol} dose for {weight}kg',
                    'response': 'Paracetamol dosing: 15mg/kg per dose, every 6-8 hours, maximum 4 doses per day. For {weight}kg: {dose}mg per dose. Use syrup (120mg/5ml) or tablets (500mg). Give with food. Safe for all ages including pregnancy. Do not exceed maximum daily dose.',
                    'category': 'General Treatment',
                    'severity': 'Low',
                    'referral': 'No'
                },
                {
                    'query_template': 'when to refer patient',
                    'response': 'Refer when: danger/emergency signs present, diagnosis uncertain, treatment not available at your level, no improvement after 2 days, patient worsening, or beyond scope of CHW practice. Always stabilize before transfer when possible (e.g., pre-referral treatment).',
                    'category': 'General Triage',
                    'severity': 'Low',
                    'referral': 'Conditional'
                }
            ]
        }

    def apply_typo(self, word: str, probability: float = 0.3) -> str:
        """Apply realistic typos"""
        if random.random() > probability:
            return word

        for correct, variants in self.typo_mappings.items():
            if correct in word.lower():
                return word.lower().replace(correct, random.choice(variants))
        return word

    def pidginize(self, text: str, intensity: float = 0.4) -> str:
        """Add Nigerian Pidgin influence"""
        if random.random() > intensity:
            return text

        for english, pidgin_variants in self.pidgin_words.items():
            if english in text.lower() and random.random() < 0.5:
                replacement = random.choice(pidgin_variants)
                text = re.sub(r'\b' + english + r'\b', replacement, text, flags=re.IGNORECASE)
        return text

    def make_fragmented(self, text: str, probability: float = 0.25) -> str:
        """Create fragmented/rushed queries"""
        if random.random() > probability:
            return text

        # Remove random words
        words = text.split()
        if len(words) > 3:
            words = [w for w in words if random.random() > 0.2]

        # Remove punctuation
        text = ' '.join(words).replace('?', '').replace('.', '')

        return text

    def generate_query_variations(self, template: Dict) -> List[Tuple[str, Dict]]:
        """Generate multiple realistic variations of a query template"""
        variations = []
        num_variations = random.randint(2, 4)

        for _ in range(num_variations):
            query = template['query_template']
            response = template['response']

            # Fill in placeholders from pidgin vocabulary
            for category, options in self.pidgin_words.items():
                placeholder = '{' + category + '}'
                if placeholder in query:
                    query = query.replace(placeholder, random.choice(options))

            # Fill in other medical term placeholders
            if '{amoxicillin}' in query:
                query = query.replace('{amoxicillin}', random.choice(['amoxicillin', 'amoxcilin', 'amox']))
            if '{pregnant}' in query:
                query = query.replace('{pregnant}', random.choice(['pregnant', 'pregnent', 'pregnat']))
            if '{bleeding}' in query:
                query = query.replace('{bleeding}', random.choice(['bleeding', 'bleading', 'blood loss']))
            if '{paracetamol}' in query:
                query = query.replace('{paracetamol}', random.choice(['paracetamol', 'paracetmol', 'para']))
            if '{immunization}' in query:
                query = query.replace('{immunization}', random.choice(['immunization', 'imunization', 'vaccine']))

            # Fill weight placeholder
            if '{weight}' in query:
                weight = random.choice([5, 8, 10, 12, 15, 18, 20, 25, 30])
                query = query.replace('{weight}', str(weight))
                # Update response with calculated dose if paracetamol
                if '{dose}' in response:
                    dose = weight * 15
                    response = response.replace('{weight}', str(weight)).replace('{dose}', str(dose))

            # Apply realistic variations
            variation_type = random.choice(['clean', 'typo', 'pidgin', 'fragmented', 'mixed'])

            if variation_type == 'typo':
                query = self.apply_typo(query, probability=0.5)
            elif variation_type == 'pidgin':
                query = self.pidginize(query, intensity=0.6)
            elif variation_type == 'fragmented':
                query = self.make_fragmented(query, probability=0.8)
            elif variation_type == 'mixed':
                query = self.pidginize(query, intensity=0.3)
                query = self.apply_typo(query, probability=0.3)
                if random.random() < 0.3:
                    query = self.make_fragmented(query, probability=0.5)

            # Ensure uniqueness
            if query.lower() not in self.generated_queries:
                self.generated_queries.add(query.lower())
                variations.append((
                    query,
                    {
                        'response': response,
                        'category': template['category'],
                        'severity': template['severity'],
                        'referral': template['referral']
                    }
                ))

        return variations

    def generate_additional_queries(self) -> List[Dict]:
        """Generate additional realistic ad-hoc queries"""
        additional = [
            # Short fragmented queries
            ("child fever 3days", "Check for: malaria (do RDT), pneumonia (count respirations), other infection. Give paracetamol 15mg/kg for fever. If fever >5 days, very high fever >39°C, or danger signs present - refer. Ensure adequate fluids.", "Fever Management", "Moderate", "Conditional"),
            ("dose for 12kg", "Please specify the medication. Common doses for 12kg child: Paracetamol 180mg, Amoxicillin 240mg BD, ACT 2 tablets BD, ORS 100-200ml per stool, Zinc 20mg daily. Always confirm the specific drug before administering.", "General Treatment", "Low", "No"),
            ("pregnant woman bleeding", "EMERGENCY - REFER IMMEDIATELY. Any bleeding in pregnancy is potentially dangerous. Assess: How much? Pain? Gestation? Do not examine. Keep flat, monitor vitals, transfer urgently to hospital with blood bank and surgical capability.", "Maternal Emergency", "Critical", "Yes"),
            ("ORS and zinc?", "ORS: Give after each loose stool. <2y: 50-100ml, 2-10y: 100-200ml, >10y: 200-400ml. Zinc: <6mo: 10mg x10d, ≥6mo: 20mg x10d. Together they reduce diarrhea duration and severity. Continue breastfeeding.", "Diarrhea", "Low", "No"),
            ("referral signs malaria", "URGENT referral if: convulsions, unconscious, unable to drink/breastfeed, repeated vomiting, severe anemia (very pale palms), respiratory distress, dark/coca-cola urine (hemoglobinuria), prostration. Give pre-referral rectal artesunate if available.", "Severe Malaria", "Critical", "Yes"),

            # Pidgin-influenced
            ("pikin dey vomit everything", "Check for danger signs: can child drink? Lethargic? Sunken eyes? Severe dehydration needs IV fluids - REFER. Mild cases: give small frequent sips of ORS, continue breastfeeding. If vomiting persists >24hrs or worsening, refer.", "Vomiting", "Moderate", "Conditional"),
            ("hot body no gree go down", "Persistent fever despite paracetamol suggests infection needing treatment, not just fever control. Investigate: malaria (RDT), pneumonia (respiratory rate), UTI, typhoid. If fever >5 days or very high >40°C, refer for investigation.", "Fever Management", "Moderate", "Yes"),
            ("baby no gree suck breast", "DANGER SIGN in newborn. Unable to feed indicates serious illness (sepsis, meningitis, respiratory distress). Check: temperature, respiratory rate, consciousness, jaundice. REFER URGENTLY. This is neonatal emergency.", "Neonatal Emergency", "Critical", "Yes"),
            ("wetin fit cause convultion", "Causes in children: malaria (most common in endemic areas), meningitis, severe infections, electrolyte imbalance, epilepsy, hypoglycemia. In febrile child, assume severe malaria or meningitis - REFER URGENTLY with pre-referral treatment.", "Convulsions", "High", "Yes"),

            # Typo-heavy
            ("chld with diarea and feva", "Likely gastroenteritis with dehydration risk. Give ORS after each stool, zinc 10-20mg x10days based on age. Check for dehydration: sunken eyes, skin pinch, urine output. Give paracetamol for fever. If bloody stool or severe dehydration - refer.", "Diarrhea", "Moderate", "Conditional"),
            ("amoxycilin dosge 15kg", "Amoxicillin 40mg/kg/day for pneumonia: 15kg = 600mg daily = 300mg twice daily. Using 250mg/5ml suspension: 6ml BD x5 days. Must complete full 5-day course. Return if: worsening, not improving after 2 days, danger signs.", "Pneumonia", "Low", "No"),
            ("pregnat lady severr headach", "DANGER SIGN - possible preeclampsia. Check BP if available. If severe headache + any of: blurred vision, epigastric pain, edema, BP ≥140/90 - REFER URGENTLY. May need MgSO4 to prevent eclampsia. This is obstetric emergency.", "Maternal Emergency", "Critical", "Yes"),

            # Clinical scenarios
            ("rdt positive child refusing food", "Unable to eat/drink is DANGER SIGN indicating severe malaria. REFER URGENTLY. Give pre-referral rectal artesunate 10mg/kg if available and trained. Check for other danger signs: convulsions, unconsciousness, very pale. Do not delay transfer.", "Severe Malaria", "Critical", "Yes"),
            ("baby breathing very fast", "Count respiratory rate for full minute: <2mo: ≥60/min, 2-12mo: ≥50/min, 1-5y: ≥40/min is fast breathing. With cough/difficulty breathing = pneumonia. Give amoxicillin 40mg/kg/day BD x5d. If chest indrawing, grunting, or very fast - REFER URGENTLY.", "Pneumonia", "Moderate", "Conditional"),
            ("mother says breast milk not enough", "Most women produce enough milk - often perception issue. Check: baby gaining weight? Wet diapers 6+/day? Check latch and feeding frequency (8-12x/day). Advise: frequent feeding increases supply, adequate maternal nutrition/fluids. Reassure mother. Avoid formula if breastfeeding possible.", "Breastfeeding", "Low", "No"),
            ("child not urinating since morning", "No urine >6 hours indicates severe dehydration or renal problem. URGENT REFERRAL for IV fluids. If conscious and can drink, give ORS during transfer. This is serious sign requiring immediate hospital care.", "Severe Dehydration", "Critical", "Yes"),

            # Dosage queries
            ("act dosing chart", "ACT (Artemether-Lumefantrine): 5-14kg: 1 tab BD, 15-24kg: 2 tabs BD, 25-34kg: 3 tabs BD, ≥35kg: 4 tabs BD. All for 3 days. Take with fatty food/milk for better absorption. Complete full course even if feeling better.", "Malaria", "Low", "No"),
            ("para syrup for 2 year old", "2-year-old roughly 10-12kg. Paracetamol 15mg/kg = 150-180mg per dose. Syrup is 120mg/5ml, so give 6-7.5ml per dose. Can repeat every 6-8 hours, maximum 4 doses/day. Give with food.", "General Treatment", "Low", "No"),
            ("amox for 6 months baby", "6-month-old pneumonia: Amoxicillin 40mg/kg/day divided BD x5 days. Average 6mo = 7-8kg = 280-320mg daily = 140-160mg BD. Using 125mg/5ml: 5.5-6.5ml BD. Ensure proper diagnosis (fast breathing + cough) before treating.", "Pneumonia", "Low", "No"),

            # Danger sign queries
            ("what are neonatal danger signs", "Neonatal danger signs requiring URGENT referral: not feeding well, convulsions, drowsy/unconscious, grunting, very fast breathing (≥60/min), severe chest indrawing, fever or cold to touch, umbilical redness/discharge, jaundice <24hrs or palms/soles yellow, less than 3 wet diapers/day.", "Neonatal Emergency", "Critical", "Yes"),
            ("signs of severe pneumonia", "Severe pneumonia danger signs: chest indrawing, nasal flaring, grunting, stridor, cyanosis (blue lips/skin), unable to drink, very fast breathing, oxygen saturation <90%. REFER URGENTLY for injectable antibiotics and oxygen. Give pre-referral IM benzylpenicillin if trained.", "Severe Pneumonia", "Critical", "Yes"),
            ("when is malaria complicated", "Complicated/severe malaria signs: convulsions, unconsciousness, unable to drink/eat, repeated vomiting, very pale (severe anemia), respiratory distress, dark urine, jaundice, bleeding. Any of these = medical emergency. Give rectal artesunate + URGENT referral.", "Severe Malaria", "Critical", "Yes"),
        ]

        return [
            {
                'query': q[0],
                'response': q[1],
                'category': q[2],
                'severity': q[3],
                'referral': q[4]
            }
            for q in additional
        ]

    def generate_dataset(self, target_count: int = 555) -> pd.DataFrame:
        """Generate complete synthetic dataset"""
        data = []

        # Generate from templates
        for category, templates in self.templates.items():
            for template in templates:
                variations = self.generate_query_variations(template)
                for query, metadata in variations:
                    if len(data) >= target_count:
                        break
                    data.append({
                        'ID': f"CHW_{self.conversation_id:04d}",
                        'Category': metadata['category'],
                        'CHW_Query': query,
                        'HIVA_Response': metadata['response'],
                        'Severity_Level': metadata['severity'],
                        'Referral_Required': metadata['referral']
                    })
                    self.conversation_id += 1

        # Add additional queries
        additional = self.generate_additional_queries()
        for item in additional:
            if len(data) >= target_count:
                break
            data.append({
                'ID': f"CHW_{self.conversation_id:04d}",
                'Category': item['category'],
                'CHW_Query': item['query'],
                'HIVA_Response': item['response'],
                'Severity_Level': item['severity'],
                'Referral_Required': item['referral']
            })
            self.conversation_id += 1

        # Generate more variations to reach target
        while len(data) < target_count:
            category = random.choice(list(self.templates.keys()))
            template = random.choice(self.templates[category])
            variations = self.generate_query_variations(template)

            for query, metadata in variations:
                if len(data) >= target_count:
                    break
                # Only add if unique
                if not any(d['CHW_Query'].lower() == query.lower() for d in data):
                    data.append({
                        'ID': f"CHW_{self.conversation_id:04d}",
                        'Category': metadata['category'],
                        'CHW_Query': query,
                        'HIVA_Response': metadata['response'],
                        'Severity_Level': metadata['severity'],
                        'Referral_Required': metadata['referral']
                    })
                    self.conversation_id += 1

        # Convert to DataFrame
        df = pd.DataFrame(data[:target_count])

        # Add normalized query column
        df['Normalized_Query'] = df['CHW_Query'].str.lower().str.strip()

        # Reorder columns
        df = df[['ID', 'Category', 'CHW_Query', 'Normalized_Query',
                'HIVA_Response', 'Severity_Level', 'Referral_Required']]

        return df


def main():
    """Generate and save the dataset"""
    print("HIVA MediChat Synthetic Dataset Generator")
    print("=" * 60)
    print("Generating 555 realistic CHW-MediChat conversational pairs...")
    print()

    generator = HIVADatasetGenerator()
    df = generator.generate_dataset(target_count=555)

    # Save to Excel
    output_file = 'C:/Users/INEWTON/hivarun/HIVA_MediChat_Synthetic_Dataset_555.xlsx'
    df.to_excel(output_file, index=False, engine='openpyxl')

    print("[SUCCESS] Dataset Generation Complete!")
    print(f"Total Conversations: {len(df)}")
    print(f"File Location: {output_file}")
    print()

    # Display statistics
    print("Dataset Statistics:")
    print("-" * 60)
    print(f"Categories: {df['Category'].nunique()}")
    print(f"Unique Queries: {df['CHW_Query'].nunique()}")
    print()
    print("Category Distribution:")
    print(df['Category'].value_counts().to_string())
    print()
    print("Severity Distribution:")
    print(df['Severity_Level'].value_counts().to_string())
    print()
    print("Referral Distribution:")
    print(df['Referral_Required'].value_counts().to_string())
    print()
    print("=" * 60)
    print("Dataset ready for:")
    print("  - Healthcare AI fine-tuning")
    print("  - Intent classification training")
    print("  - Retrieval system evaluation")
    print("  - NLP robustness testing")
    print("  - Conversational modeling")


if __name__ == "__main__":
    main()
