# D1 Example Queries

## Customer Queries

### Get all customers
```sql
SELECT * FROM customers LIMIT 100;
```

### Count customers by initiative
```sql
SELECT initiative, COUNT(*) as customer_count
FROM customers
GROUP BY initiative
ORDER BY customer_count DESC;
```

### Customers added in last 30 days
```sql
SELECT *
FROM customers
WHERE created_at >= datetime('now', '-30 days')
ORDER BY created_at DESC;
```

## Engagement Queries

### Top engaged customers
```sql
SELECT 
  c.name,
  COUNT(a.id) as activity_count,
  MAX(a.created_at) as last_activity
FROM customers c
LEFT JOIN activities a ON c.id = a.customer_id
GROUP BY c.id
ORDER BY activity_count DESC
LIMIT 20;
```

### Inactive customers (no activity in 90 days)
```sql
SELECT *
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM activities a
  WHERE a.customer_id = c.id
  AND a.created_at >= datetime('now', '-90 days')
)
ORDER BY c.created_at DESC;
```

## Opportunity Queries

### Customers with Feature A but not Feature B
```sql
SELECT DISTINCT c.name, c.id
FROM customers c
WHERE EXISTS (
  SELECT 1 FROM features f
  WHERE f.customer_id = c.id AND f.name = 'Feature A'
)
AND NOT EXISTS (
  SELECT 1 FROM features f
  WHERE f.customer_id = c.id AND f.name = 'Feature B'
);
```

### High-value customers (>$X annual spend)
```sql
SELECT 
  c.name,
  SUM(s.amount) as total_spend
FROM customers c
JOIN subscriptions s ON c.id = s.customer_id
GROUP BY c.id
HAVING total_spend > 5000
ORDER BY total_spend DESC;
```

### Expansion opportunities (single product customers)
```sql
SELECT 
  c.name,
  COUNT(DISTINCT p.name) as product_count,
  GROUP_CONCAT(DISTINCT p.name) as products
FROM customers c
JOIN products p ON c.id = p.customer_id
GROUP BY c.id
HAVING product_count = 1
ORDER BY c.created_at DESC;
```

## Cross-Initiative Queries

### Customers that could benefit from initiative expansion
```sql
SELECT 
  c.*,
  i.name as current_initiative,
  COUNT(DISTINCT f.id) as feature_count
FROM customers c
JOIN initiatives i ON c.initiative_id = i.id
LEFT JOIN features f ON c.id = f.customer_id
GROUP BY c.id
ORDER BY feature_count DESC;
```

## Implementation Pattern Queries

### Most common implementation timeframes
```sql
SELECT 
  implementation_phase,
  AVG(CAST(days_to_completion AS FLOAT)) as avg_days,
  COUNT(*) as count
FROM implementations
GROUP BY implementation_phase
ORDER BY avg_days DESC;
```

### Successful implementations by initiative
```sql
SELECT 
  i.name as initiative,
  COUNT(*) as total_implementations,
  SUM(CASE WHEN impl.status = 'completed' THEN 1 ELSE 0 END) as completed,
  ROUND(100.0 * SUM(CASE WHEN impl.status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM initiatives i
LEFT JOIN implementations impl ON i.id = impl.initiative_id
GROUP BY i.id
ORDER BY success_rate DESC;
```
