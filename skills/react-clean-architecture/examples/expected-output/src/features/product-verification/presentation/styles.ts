import { StyleSheet } from 'react-native';
import { Theme } from '@core/theme/types';

export const createStyles = (theme: Theme) =>
    StyleSheet.create({
        // every value here is a theme token — reviewers reject raw numbers and
        // raw RN keywords in styles. Missing token? add it to
        // src/core/theme/baseStyles.ts (+ the Theme type) and use it from there.
        container: {
            flex: theme.flex1,
            backgroundColor: theme.colors.background,
            padding: theme.spacing.md,
        },
    });
