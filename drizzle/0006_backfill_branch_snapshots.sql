INSERT INTO `snapshots` (
  `id`, `session_id`, `branch_id`, `turn_id`, `sequence`,
  `state_json`, `name`, `kind`, `created_at`
)
SELECT
  lower(hex(randomblob(16))),
  `branches`.`session_id`,
  `branches`.`id`,
  `branches`.`head_turn_id`,
  `turns`.`sequence`,
  json_object(
    'schemaVersion', '1.0.0',
    'states', json_group_array(
      json_object(
        'entityType', `materialized_states`.`entity_type`,
        'entityId', `materialized_states`.`entity_id`,
        'state', json(`materialized_states`.`state_json`),
        'isActive', json(
          CASE
            WHEN `materialized_states`.`is_active` = 1 THEN 'true'
            ELSE 'false'
          END
        ),
        'version', `materialized_states`.`version`,
        'updatedTurnId', `materialized_states`.`updated_turn_id`,
        'updatedAt', `materialized_states`.`updated_at`
      )
    )
  ),
  '升级时自动存档',
  'automatic',
  CURRENT_TIMESTAMP
FROM `branches`
JOIN `turns` ON `turns`.`id` = `branches`.`head_turn_id`
JOIN `materialized_states`
  ON `materialized_states`.`session_id` = `branches`.`session_id`
  AND `materialized_states`.`branch_id` = `branches`.`id`
WHERE NOT EXISTS (
  SELECT 1 FROM `snapshots`
  WHERE `snapshots`.`branch_id` = `branches`.`id`
)
GROUP BY `branches`.`id`, `branches`.`session_id`,
         `branches`.`head_turn_id`, `turns`.`sequence`;
