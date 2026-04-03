use std::collections::HashMap;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertOp { Gt, Lt, Gte, Lte, Eq }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AlertDelivery { Notification, Callback, Both }

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AlertSource {
    Widget { window_id: String },
    User,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlertDef {
    pub id: String,
    pub metric: String,
    pub field: String,
    pub op: AlertOp,
    pub value: f64,
    pub duration_secs: u64,
    pub delivery: AlertDelivery,
    pub label: String,
    pub source: AlertSource,
}

/// Extract a named field from a JSON payload as f64.
pub fn extract_f64(payload: &serde_json::Value, field: &str) -> Option<f64> {
    payload.get(field)?.as_f64()
}

/// Evaluate an alert comparison operator.
pub fn eval_op(actual: f64, op: &AlertOp, threshold: f64) -> bool {
    match op {
        AlertOp::Gt  => actual > threshold,
        AlertOp::Lt  => actual < threshold,
        AlertOp::Gte => actual >= threshold,
        AlertOp::Lte => actual <= threshold,
        AlertOp::Eq  => (actual - threshold).abs() < f64::EPSILON,
    }
}

/// Pure evaluation: runs alert conditions for `metric` against `payload`.
/// Mutates `states` (tracks when condition first became true).
/// Returns (id, label, delivery, field, threshold, actual) for each alert that fires.
pub fn check_alert_condition(
    defs: &[AlertDef],
    states: &mut HashMap<String, Option<Instant>>,
    metric: &str,
    payload: &serde_json::Value,
) -> Vec<(String, String, AlertDelivery, String, f64, f64)> {
    let mut fired = Vec::new();
    for def in defs.iter().filter(|d| d.metric == metric) {
        let Some(actual) = extract_f64(payload, &def.field) else {
            continue;
        };
        let condition = eval_op(actual, &def.op, def.value);
        if condition {
            let entry = states.entry(def.id.clone()).or_insert(None);
            if entry.is_none() {
                *entry = Some(Instant::now());
            } else if let Some(since) = *entry {
                if since.elapsed().as_secs() >= def.duration_secs {
                    fired.push((
                        def.id.clone(),
                        def.label.clone(),
                        def.delivery.clone(),
                        def.field.clone(),
                        def.value,
                        actual,
                    ));
                    *entry = None; // hysteresis: reset after firing
                }
            }
        } else {
            states.insert(def.id.clone(), None);
        }
    }
    fired
}

/// Fire a single alert: OS notification and/or flux:alert event.
pub fn deliver_alert(
    app: &AppHandle,
    id: &str,
    label: &str,
    delivery: &AlertDelivery,
    metric: &str,
    field: &str,
    threshold: f64,
    actual: f64,
) {
    let event_payload = serde_json::json!({
        "id":     id,
        "label":  label,
        "metric": metric,
        "field":  field,
        "value":  threshold,
        "actual": actual,
    });

    if matches!(delivery, AlertDelivery::Notification | AlertDelivery::Both) {
        use tauri_plugin_notification::NotificationExt;
        let body = format!("{field} is {actual:.1} (threshold: {threshold:.1})");
        let _ = app.notification().builder().title(label).body(&body).show();
    }

    if matches!(delivery, AlertDelivery::Callback | AlertDelivery::Both) {
        let _ = app.emit("flux:alert", &event_payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    fn cpu_payload(avg: f64) -> serde_json::Value {
        serde_json::json!({ "avg_usage": avg, "cpu_temp": 55.0 })
    }

    fn make_def(metric: &str, field: &str, op: AlertOp, value: f64, duration_secs: u64) -> AlertDef {
        AlertDef {
            id: "test-id".to_string(),
            metric: metric.to_string(),
            field: field.to_string(),
            op,
            value,
            duration_secs,
            delivery: AlertDelivery::Both,
            label: "Test Alert".to_string(),
            source: AlertSource::User,
        }
    }

    #[test]
    fn extract_f64_returns_numeric_field() {
        let payload = cpu_payload(75.5);
        assert_eq!(extract_f64(&payload, "avg_usage"), Some(75.5));
    }

    #[test]
    fn extract_f64_missing_field_returns_none() {
        let payload = cpu_payload(75.5);
        assert_eq!(extract_f64(&payload, "nonexistent"), None);
    }

    #[test]
    fn extract_f64_string_field_returns_none() {
        let payload = serde_json::json!({ "name": "Intel" });
        assert_eq!(extract_f64(&payload, "name"), None);
    }

    #[test]
    fn eval_op_gt() {
        assert!(eval_op(81.0, &AlertOp::Gt, 80.0));
        assert!(!eval_op(80.0, &AlertOp::Gt, 80.0));
    }

    #[test]
    fn eval_op_lt() {
        assert!(eval_op(79.0, &AlertOp::Lt, 80.0));
        assert!(!eval_op(80.0, &AlertOp::Lt, 80.0));
    }

    #[test]
    fn eval_op_gte_equal() {
        assert!(eval_op(80.0, &AlertOp::Gte, 80.0));
        assert!(eval_op(81.0, &AlertOp::Gte, 80.0));
        assert!(!eval_op(79.0, &AlertOp::Gte, 80.0));
    }

    #[test]
    fn eval_op_lte_equal() {
        assert!(eval_op(80.0, &AlertOp::Lte, 80.0));
        assert!(eval_op(79.0, &AlertOp::Lte, 80.0));
        assert!(!eval_op(81.0, &AlertOp::Lte, 80.0));
    }

    #[test]
    fn check_condition_fires_after_duration() {
        let def = make_def("cpu", "avg_usage", AlertOp::Gt, 80.0, 0);
        let mut states: HashMap<String, Option<Instant>> = HashMap::new();
        states.insert("test-id".to_string(), Some(Instant::now() - Duration::from_secs(5)));
        let payload = cpu_payload(90.0);
        let fired = check_alert_condition(&[def], &mut states, "cpu", &payload);
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].0, "test-id");
        assert_eq!(fired[0].5, 90.0);
    }

    #[test]
    fn check_condition_does_not_fire_before_duration() {
        let def = make_def("cpu", "avg_usage", AlertOp::Gt, 80.0, 60);
        let mut states: HashMap<String, Option<Instant>> = HashMap::new();
        let payload = cpu_payload(90.0);
        let fired = check_alert_condition(&[def], &mut states, "cpu", &payload);
        assert!(fired.is_empty());
        assert!(states["test-id"].is_some());
    }

    #[test]
    fn check_condition_resets_state_when_condition_clears() {
        let def = make_def("cpu", "avg_usage", AlertOp::Gt, 80.0, 60);
        let mut states: HashMap<String, Option<Instant>> = HashMap::new();
        states.insert("test-id".to_string(), Some(Instant::now() - Duration::from_secs(10)));
        let payload = cpu_payload(70.0);
        let fired = check_alert_condition(&[def], &mut states, "cpu", &payload);
        assert!(fired.is_empty());
        assert!(states["test-id"].is_none());
    }

    #[test]
    fn check_condition_does_not_fire_for_different_metric() {
        let def = make_def("memory", "used", AlertOp::Gt, 1000.0, 0);
        let mut states: HashMap<String, Option<Instant>> = HashMap::new();
        states.insert("test-id".to_string(), Some(Instant::now() - Duration::from_secs(5)));
        let payload = cpu_payload(90.0);
        let fired = check_alert_condition(&[def], &mut states, "cpu", &payload);
        assert!(fired.is_empty());
    }

    #[test]
    fn check_condition_resets_state_after_firing() {
        let def = make_def("cpu", "avg_usage", AlertOp::Gt, 80.0, 0);
        let mut states: HashMap<String, Option<Instant>> = HashMap::new();
        states.insert("test-id".to_string(), Some(Instant::now() - Duration::from_secs(5)));
        let payload = cpu_payload(90.0);
        let fired = check_alert_condition(&[def.clone()], &mut states, "cpu", &payload);
        assert_eq!(fired.len(), 1);
        assert!(states["test-id"].is_none()); // reset after fire
        let fired2 = check_alert_condition(&[def], &mut states, "cpu", &payload);
        assert!(fired2.is_empty()); // sets Instant again but doesn't fire yet
    }
}
