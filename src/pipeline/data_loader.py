import pandas as pd
from pathlib import Path

def load_csv(file_path: str | Path) -> pd.DataFrame:
    """
    Load a CSV file into a pandas DataFrame.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Data file not found: {path}")
    
    return pd.read_csv(path)

def validate_schema(df: pd.DataFrame) -> bool:
    """
    Validate that the DataFrame contains the required columns.
    Expected columns: date, sales, promo, holiday
    """
    required_columns = {'date', 'sales', 'promo', 'holiday'}
    if not required_columns.issubset(df.columns):
        missing = required_columns - set(df.columns)
        raise ValueError(f"Missing required columns: {missing}")
    
    # Check data types if needed
    if not pd.api.types.is_numeric_dtype(df['sales']):
        raise ValueError("Column 'sales' must be numeric.")
        
    return True
