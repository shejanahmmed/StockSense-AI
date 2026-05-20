import pandas as pd

def create_date_features(df: pd.DataFrame, date_col: str = 'date', region: str = "US") -> pd.DataFrame:
    """
    Extract date-based features like day of week, month, etc.
    """
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])
    
    df['day_of_week'] = df[date_col].dt.dayofweek
    df['month'] = df[date_col].dt.month
    
    # Regional weekend mapping: BD is Friday (4) & Saturday (5). Others are Saturday (5) & Sunday (6).
    weekend_days = [4, 5] if region == "BD" else [5, 6]
    df['is_weekend'] = df['day_of_week'].isin(weekend_days).astype(int)
    
    return df

def create_lag_features(df: pd.DataFrame, target_col: str = 'sales', lags: list[int] = [1, 7, 30]) -> pd.DataFrame:
    """
    Create lag features for the target variable.
    """
    df = df.copy()
    # Ensure sorted by date
    df = df.sort_values('date')
    
    for lag in lags:
        df[f'{target_col}_lag_{lag}'] = df[target_col].shift(lag)
        
    return df

def create_rolling_stats(df: pd.DataFrame, target_col: str = 'sales', windows: list[int] = [7, 30]) -> pd.DataFrame:
    """
    Create rolling mean and standard deviation features.
    """
    df = df.copy()
    df = df.sort_values('date')
    
    for window in windows:
        df[f'{target_col}_rolling_mean_{window}'] = df[target_col].rolling(window=window, min_periods=1).mean()
        df[f'{target_col}_rolling_std_{window}'] = df[target_col].rolling(window=window, min_periods=1).std().fillna(0)
        
    return df
