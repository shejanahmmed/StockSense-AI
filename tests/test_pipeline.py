import pytest
import pandas as pd
from src.pipeline.data_loader import validate_schema
from src.pipeline.feature_engineering import create_date_features, create_lag_features, create_rolling_stats

def test_data_loader_schema_validation():
    """Test that the schema validator correctly accepts valid data and rejects invalid data."""
    # Valid data
    df_valid = pd.DataFrame({
        'date': ['2023-01-01', '2023-01-02'],
        'store_id': [1, 1],
        'item_id': [101, 101],
        'sales': [50, 60],
        'price': [10.5, 10.5],
        'promo': [0, 0],
        'holiday': [0, 0]
    })
    try:
        validate_schema(df_valid)
    except Exception as e:
        pytest.fail(f"validate_schema failed on valid data: {e}")

    # Invalid data (missing 'sales')
    df_invalid = pd.DataFrame({
        'date': ['2023-01-01'],
        'store_id': [1],
        'price': [10.5]
    })
    with pytest.raises(ValueError, match="Missing required columns"):
        validate_schema(df_invalid)

def test_feature_engineering_dates():
    """Test date-based feature engineering (day of week, month, weekend)."""
    df = pd.DataFrame({
        'date': pd.date_range(start='2023-01-06', periods=3, freq='D'), # Fri, Sat, Sun
        'sales': [10, 20, 30]
    })
    
    # 1. Test US Region (Saturday & Sunday weekend)
    df_us = create_date_features(df.copy(), region="US")
    assert 'day_of_week' in df_us.columns
    assert 'is_weekend' in df_us.columns
    assert 'month' in df_us.columns
    
    # 2023-01-06 is Friday (not weekend in US)
    assert df_us.iloc[0]['is_weekend'] == 0
    # 2023-01-07 is Saturday (weekend in US)
    assert df_us.iloc[1]['is_weekend'] == 1
    # 2023-01-08 is Sunday (weekend in US)
    assert df_us.iloc[2]['is_weekend'] == 1

    # 2. Test Bangladesh Region (Friday & Saturday weekend)
    df_bd = create_date_features(df.copy(), region="BD")
    # 2023-01-06 is Friday (weekend in BD)
    assert df_bd.iloc[0]['is_weekend'] == 1
    # 2023-01-07 is Saturday (weekend in BD)
    assert df_bd.iloc[1]['is_weekend'] == 1
    # 2023-01-08 is Sunday (not weekend in BD)
    assert df_bd.iloc[2]['is_weekend'] == 0

def test_feature_engineering_lags():
    """Test lag feature generation for time series models."""
    df = pd.DataFrame({
        'date': pd.date_range(start='2023-01-01', periods=5, freq='D'),
        'sales': [10, 20, 30, 40, 50]
    })
    
    df_lag = create_lag_features(df.copy(), lags=[2])
    
    assert 'sales_lag_2' in df_lag.columns
    # The first two rows should be NaN since there is no data 2 days prior
    assert pd.isna(df_lag['sales_lag_2'].iloc[0])
    assert pd.isna(df_lag['sales_lag_2'].iloc[1])
    # The third row (index 2) should have the value of the first row (index 0)
    assert df_lag['sales_lag_2'].iloc[2] == 10.0

def test_feature_engineering_rolling():
    """Test rolling statistics generation for time series models."""
    df = pd.DataFrame({
        'date': pd.date_range(start='2023-01-01', periods=5, freq='D'),
        'sales': [10, 20, 30, 40, 50]
    })
    
    df_roll = create_rolling_stats(df.copy(), windows=[3])
    
    assert 'sales_rolling_mean_3' in df_roll.columns
    # Since min_periods=1, the first element (10) mean is 10.0, the second (10, 20) mean is 15.0
    assert df_roll['sales_rolling_mean_3'].iloc[1] == 15.0
    assert df_roll['sales_rolling_mean_3'].iloc[2] == 20.0
