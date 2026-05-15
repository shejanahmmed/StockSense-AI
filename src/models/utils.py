import numpy as np

def calculate_rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """
    Calculate Root Mean Squared Error.
    """
    return np.sqrt(np.mean((y_true - y_pred) ** 2))

def calculate_mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """
    Calculate Mean Absolute Percentage Error.
    """
    # Avoid division by zero
    mask = y_true != 0
    return np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100

def evaluate_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """
    Calculate a comprehensive set of metrics.
    """
    return {
        "rmse": calculate_rmse(y_true, y_pred),
        "mape": calculate_mape(y_true, y_pred)
    }
