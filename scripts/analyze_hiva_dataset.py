"""
HIVA Dataset Analysis Script
Quick analysis of the synthetic conversational dataset
"""

import pandas as pd
from collections import Counter
import re

def load_dataset(filepath='HIVA_MediChat_Synthetic_Dataset_555.xlsx'):
    """Load the HIVA dataset"""
    df = pd.read_excel(filepath)
    print(f"[INFO] Loaded {len(df)} conversational pairs")
    return df

def basic_statistics(df):
    """Display basic dataset statistics"""
    print("\n" + "="*60)
    print("BASIC STATISTICS")
    print("="*60)

    print(f"\nTotal Conversations: {len(df)}")
    print(f"Unique Categories: {df['Category'].nunique()}")
    print(f"Unique Queries: {df['CHW_Query'].nunique()}")

    # Query length analysis
    df['query_length'] = df['CHW_Query'].str.len()
    df['query_words'] = df['CHW_Query'].str.split().str.len()

    print(f"\nQuery Length (characters):")
    print(f"  Mean: {df['query_length'].mean():.1f}")
    print(f"  Median: {df['query_length'].median():.1f}")
    print(f"  Min: {df['query_length'].min()}")
    print(f"  Max: {df['query_length'].max()}")

    print(f"\nQuery Length (words):")
    print(f"  Mean: {df['query_words'].mean():.1f}")
    print(f"  Median: {df['query_words'].median():.1f}")
    print(f"  Min: {df['query_words'].min()}")
    print(f"  Max: {df['query_words'].max()}")

def category_analysis(df):
    """Analyze category distribution"""
    print("\n" + "="*60)
    print("CATEGORY DISTRIBUTION")
    print("="*60)

    category_counts = df['Category'].value_counts()
    print("\nTop 15 Categories:")
    for cat, count in category_counts.head(15).items():
        percentage = (count / len(df)) * 100
        print(f"  {cat:30} {count:3} ({percentage:5.2f}%)")

def severity_analysis(df):
    """Analyze severity distribution"""
    print("\n" + "="*60)
    print("SEVERITY DISTRIBUTION")
    print("="*60)

    severity_counts = df['Severity_Level'].value_counts()
    print()
    for severity, count in severity_counts.items():
        percentage = (count / len(df)) * 100
        print(f"  {severity:15} {count:3} ({percentage:5.2f}%)")

def referral_analysis(df):
    """Analyze referral patterns"""
    print("\n" + "="*60)
    print("REFERRAL DISTRIBUTION")
    print("="*60)

    referral_counts = df['Referral_Required'].value_counts()
    print()
    for referral, count in referral_counts.items():
        percentage = (count / len(df)) * 100
        print(f"  {referral:15} {count:3} ({percentage:5.2f}%)")

def linguistic_analysis(df):
    """Analyze linguistic features"""
    print("\n" + "="*60)
    print("LINGUISTIC FEATURES")
    print("="*60)

    # Pidgin words detection
    pidgin_words = ['pikin', 'feva', 'wetin', 'dey', 'gree', 'chop', 'wahala']
    pidgin_count = df['CHW_Query'].str.contains('|'.join(pidgin_words), case=False, regex=True).sum()

    # Medical typos detection
    typo_patterns = ['diaroea', 'pnemonia', 'malarya', 'amoxcilin', 'imunization', 'convultion', 'pregnat']
    typo_count = df['CHW_Query'].str.contains('|'.join(typo_patterns), case=False, regex=True).sum()

    # Short queries (< 20 chars)
    df['query_length'] = df['CHW_Query'].str.len()
    short_queries = (df['query_length'] < 20).sum()

    print(f"\nQueries with Pidgin influence: {pidgin_count} ({pidgin_count/len(df)*100:.1f}%)")
    print(f"Queries with realistic typos: {typo_count} ({typo_count/len(df)*100:.1f}%)")
    print(f"Fragmented queries (<20 chars): {short_queries} ({short_queries/len(df)*100:.1f}%)")

def clinical_domain_analysis(df):
    """Analyze clinical domains"""
    print("\n" + "="*60)
    print("CLINICAL DOMAIN ANALYSIS")
    print("="*60)

    # Group by major domains
    domains = {
        'Infectious Diseases': ['Malaria', 'Severe Malaria', 'Pneumonia', 'Severe Pneumonia',
                                'Diarrhea', 'Dysentery', 'HIV/TB', 'Fever Management'],
        'Maternal Health': ['Maternal Emergency', 'Antenatal Care', 'Postpartum Emergency'],
        'Neonatal Health': ['Neonatal Emergency', 'Neonatal Infection', 'Neonatal Jaundice', 'Breastfeeding'],
        'Child Health': ['Immunization', 'Severe Malnutrition', 'Nutrition'],
        'General': ['General Treatment', 'General Triage', 'Severe Dehydration', 'Vomiting', 'Convulsions']
    }

    print("\nBy Clinical Domain:")
    for domain, categories in domains.items():
        count = df[df['Category'].isin(categories)].shape[0]
        percentage = (count / len(df)) * 100
        print(f"  {domain:25} {count:3} ({percentage:5.2f}%)")

def emergency_analysis(df):
    """Analyze emergency/critical cases"""
    print("\n" + "="*60)
    print("EMERGENCY CASE ANALYSIS")
    print("="*60)

    critical = df[df['Severity_Level'] == 'Critical']
    urgent_referral = df[df['Referral_Required'] == 'Yes']

    print(f"\nCritical Cases: {len(critical)} ({len(critical)/len(df)*100:.1f}%)")
    print(f"Urgent Referrals: {len(urgent_referral)} ({len(urgent_referral)/len(df)*100:.1f}%)")

    print("\nTop Critical Categories:")
    for cat, count in critical['Category'].value_counts().head(10).items():
        print(f"  {cat:30} {count:3}")

def sample_conversations(df, n=5):
    """Display sample conversations"""
    print("\n" + "="*60)
    print("SAMPLE CONVERSATIONS")
    print("="*60)

    # Sample from different categories
    categories_to_sample = ['Malaria', 'Neonatal Emergency', 'Maternal Emergency',
                           'Pneumonia', 'Diarrhea']

    for category in categories_to_sample:
        subset = df[df['Category'] == category]
        if len(subset) > 0:
            sample = subset.sample(1).iloc[0]
            print(f"\n[{sample['Category']}] - Severity: {sample['Severity_Level']}")
            print(f"CHW: {sample['CHW_Query']}")
            print(f"HIVA: {sample['HIVA_Response'][:150]}...")
            print("-" * 60)

def data_quality_check(df):
    """Check data quality"""
    print("\n" + "="*60)
    print("DATA QUALITY CHECK")
    print("="*60)

    checks = {
        'No missing values': df.isnull().sum().sum() == 0,
        'All IDs unique': df['ID'].nunique() == len(df),
        'All queries unique': df['CHW_Query'].nunique() == len(df),
        'Valid severity levels': df['Severity_Level'].isin(['Low', 'Moderate', 'High', 'Critical']).all(),
        'Valid referral values': df['Referral_Required'].isin(['Yes', 'No', 'Conditional']).all(),
        'Non-empty queries': (df['CHW_Query'].str.len() > 0).all(),
        'Non-empty responses': (df['HIVA_Response'].str.len() > 0).all()
    }

    print()
    for check, passed in checks.items():
        status = "[PASS]" if passed else "[FAIL]"
        print(f"  {status} {check}")

    all_passed = all(checks.values())
    print(f"\nOverall Quality: {'EXCELLENT' if all_passed else 'NEEDS REVIEW'}")

def main():
    """Run complete analysis"""
    print("\n" + "="*70)
    print(" "*15 + "HIVA DATASET ANALYSIS")
    print("="*70)

    # Load dataset
    df = load_dataset('../HIVA_MediChat_Synthetic_Dataset_555.xlsx')

    # Run all analyses
    basic_statistics(df)
    category_analysis(df)
    severity_analysis(df)
    referral_analysis(df)
    clinical_domain_analysis(df)
    linguistic_analysis(df)
    emergency_analysis(df)
    data_quality_check(df)
    sample_conversations(df, n=5)

    print("\n" + "="*70)
    print("Analysis Complete!")
    print("="*70)

if __name__ == "__main__":
    main()
